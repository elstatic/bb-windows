import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createServer, type Server, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { z } from "zod";
import { DESKTOP_BROWSER_BROKER_DESCRIPTOR_FILE, desktopBrowserBrokerDescriptorSchema } from "@bb/host-daemon-contract";
import { createBrowserTransport } from "./browser-transport.js";

async function run() {
  const origin = new URL(process.argv[2]).origin;
  const serverHost = new URL(origin).host.replace(/[^a-zA-Z0-9.-]/gu, "-");
  let descriptor: z.infer<typeof desktopBrowserBrokerDescriptorSchema> | null = null;
  for (const dataDir of [join(homedir(), ".bb-machines", serverHost), join(homedir(), ".bb")]) {
    try {
      const file = await open(join(dataDir, DESKTOP_BROWSER_BROKER_DESCRIPTOR_FILE), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > 16384 || (stat.mode & 0o077) || stat.uid !== process.getuid?.()) throw new Error("Invalid broker permissions");
        const candidate = desktopBrowserBrokerDescriptorSchema.parse(JSON.parse(await file.readFile("utf8")));
        if (new URL(candidate.serverUrl).origin === origin) descriptor = candidate;
      } finally { await file.close(); }
      if (descriptor) break;
    } catch { continue; }
  }
  if (!descriptor) throw new Error("No enrolled WSL browser host for the selected server");
  const upstream = new WebSocket(descriptor.url, { headers: { authorization: `Bearer ${descriptor.token}` }, handshakeTimeout: 5000, maxPayload: 24 * 1024 * 1024 });
  const channels = new Map<string, Socket>();
  const relays = new Map<string, { server: Server; timer: ReturnType<typeof setTimeout>; sockets: Set<Socket> }>();
  let stopped = false;
  let outgoing = Promise.resolve();
  function stop() {
    if (stopped) return;
    stopped = true;
    for (const socket of channels.values()) socket.destroy();
    for (const relay of relays.values()) { clearTimeout(relay.timer); relay.server.close(); }
    upstream.terminate();
    transport.close();
    process.exitCode = 0;
    process.stdin.destroy();
  }
  const transport = createBrowserTransport(process.stdin, process.stdout, frame => {
    if (frame.type === "broker") {
      if (upstream.readyState !== WebSocket.OPEN || upstream.bufferedAmount > 24 * 1024 * 1024) throw new Error("Browser broker is unavailable");
      outgoing = outgoing.then(async () => {
        if (stopped) return;
        let value = frame.value;
        const result = resultSchema.safeParse(value);
        if (result.success) value = { ...result.data, result: { ...result.data.result, wsEndpoint: await relayEndpoint(result.data.result.wsEndpoint, result.data.result.expiresAt) } };
        if (!stopped) upstream.send(JSON.stringify(value));
      }).catch(stop);
    } else if (frame.type === "data") {
      const socket = channels.get(frame.channel);
      if (!socket) return;
      if (socket.writableLength > 8 * 1024 * 1024) socket.destroy();
      else socket.write(Buffer.from(frame.data, "base64"));
    } else if (frame.type === "end") channels.get(frame.channel)?.destroy();
    else throw new Error("Unexpected Windows bridge frame");
  }, stop);
  async function relayEndpoint(endpoint: string, expiresAt: number): Promise<string> {
    const known = relays.get(endpoint);
    if (known) {
      const address = known.server.address();
      if (address && typeof address !== "string") { const url = new URL(endpoint); url.port = String(address.port); return url.href; }
    }
    const url = new URL(endpoint);
    if (url.protocol !== "ws:" || url.hostname !== "127.0.0.1" || !/^\/cdp\/[a-f0-9]{64}$/.test(url.pathname) || url.username || url.password || url.search || url.hash || !url.port || relays.size >= 100 || expiresAt <= Date.now() || expiresAt - Date.now() > 3_600_000) throw new Error("Invalid scoped browser connection");
    const port = Number(url.port);
    const sockets = new Set<Socket>();
    const server = createServer(socket => {
      if (channels.size >= 64) { socket.destroy(); return; }
      const channel = randomUUID();
      channels.set(channel, socket);
      sockets.add(socket);
      transport.send({ type: "open", channel, port });
      socket.on("data", data => { if (!transport.send({ type: "data", channel, data: data.toString("base64") })) { socket.pause(); transport.drain(() => socket.resume()); } });
      socket.on("error", () => socket.destroy());
      socket.on("close", () => { channels.delete(channel); sockets.delete(socket); if (!stopped) transport.send({ type: "end", channel }); });
    });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Browser relay did not bind");
    const timer = setTimeout(() => { relays.delete(endpoint); for (const socket of sockets) socket.destroy(); server.close(); }, expiresAt - Date.now());
    timer.unref();
    relays.set(endpoint, { server, timer, sockets });
    url.port = String(address.port);
    return url.href;
  }
  let incoming = Promise.resolve();
  const resultSchema = z.object({ type: z.literal("result"), requestId: z.string(), result: z.object({ wsEndpoint: z.string(), expiresAt: z.number() }) });
  upstream.on("open", () => transport.send({ type: "ready", hostId: descriptor.hostId, serverUrl: descriptor.serverUrl }));
  upstream.on("message", (data, binary) => {
    incoming = incoming.then(async () => {
      if (stopped) return;
      if (binary) throw new Error("Expected a JSON broker message");
      const value = z.json().parse(JSON.parse(data.toString()));
      if (!stopped) transport.send({ type: "broker", value });
    }).catch(stop);
  });
  upstream.on("error", stop);
  upstream.on("close", stop);
  process.stdin.on("end", stop);
  process.on("SIGTERM", stop);
}
void run().catch(error => { process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n"); process.exitCode = 1; });
