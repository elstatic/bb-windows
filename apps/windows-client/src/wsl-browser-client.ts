import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { connect, type Socket } from "node:net";
import { z } from "zod";
import { desktopBrowserBrokerRequestSchema, desktopBrowserResultSchemas } from "@bb/host-daemon-contract";
import type { DesktopBrowserBroker } from "../../desktop/src/desktop-browser-broker.js";
import { createBrowserTransport, windowsPathToWsl } from "./browser-transport.js";

export function createWslBrowserClient(args: {
  broker: DesktopBrowserBroker;
  helperPath: string;
  log(message: string): Promise<void>;
  getTarget(): { serverUrl: string; distribution?: string } | null;
}) {
  let child: ChildProcessWithoutNullStreams | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let generation = 0;
  let currentOrigin: string | null = null;
  function schedule() {
    if (stopped || retry) return;
    retry = setTimeout(() => { retry = null; start(); }, 5000);
    retry.unref();
  }
  function start() {
    if (stopped || child) return;
    const target = args.getTarget();
    if (!target) { schedule(); return; }
    const origin = new URL(target.serverUrl).origin;
    if (currentOrigin && currentOrigin !== origin) args.broker.resetServer();
    currentOrigin = origin;
    const attempt = ++generation;
    const helperPath = windowsPathToWsl(args.helperPath);
    const command = 'if ! command -v node >/dev/null 2>&1; then if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi; fi; exec node "$1" "$2"';
    const processArgs = [...(target.distribution ? ["--distribution", target.distribution] : []), "--exec", "bash", "-lc", command, "bb-browser", helperPath, origin];
    const worker = spawn("wsl.exe", processArgs, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    child = worker;
    const sockets = new Map<string, Socket>();
    const allowedPorts = new Map<number, number>();
    let ready = false;
    let cleaned = false;
    let pending = 0;
    let requests = Promise.resolve();
    const startup = setTimeout(() => disconnect(), 30000);
    let diagnostics = "";
    const transport = createBrowserTransport(worker.stdout, worker.stdin, frame => {
      if (attempt !== generation || stopped) return;
      if (frame.type === "ready") {
        if (ready || new URL(frame.serverUrl).origin !== origin) throw new Error("Browser host identity mismatch");
        hostId = frame.hostId;
        ready = true;
        clearTimeout(startup);
        register();
        args.broker.setHostId(frame.hostId);
        void args.log("Browser connected to enrolled WSL host");
      } else if (frame.type === "broker") {
        if (!ready) throw new Error("Browser host is not ready");
        const request = desktopBrowserBrokerRequestSchema.parse(frame.value);
        if (++pending > 64) throw new Error("Browser request limit exceeded");
        requests = requests.then(async () => {
          if (attempt !== generation || cleaned) return;
          try {
            const result = desktopBrowserResultSchemas[request.command.type].parse(await args.broker.execute(request.command));
            if (attempt !== generation || cleaned) return;
            if (request.command.type === "desktop.browser.open_connection") {
              const connection = z.object({ wsEndpoint: z.string().url(), expiresAt: z.number() }).parse(result);
              const url = new URL(connection.wsEndpoint);
              if (url.hostname !== "127.0.0.1" || url.protocol !== "ws:") throw new Error("Invalid browser bridge endpoint");
              allowedPorts.set(Number(url.port), connection.expiresAt);
            }
            transport.send({ type: "broker", value: { type: "result", requestId: request.requestId, result } });
          } catch (error) {
            if (attempt === generation && !cleaned) transport.send({ type: "broker", value: { type: "error", requestId: request.requestId, message: error instanceof Error ? error.message.slice(0, 8192) : "Browser operation failed" } });
          } finally { pending -= 1; }
        }).catch(disconnect);
      } else if (frame.type === "open") {
        if (!ready || sockets.size >= 64 || sockets.has(frame.channel) || (allowedPorts.get(frame.port) ?? 0) <= Date.now()) throw new Error("Browser channel is not authorized");
        const channel = frame.channel;
        const socket = connect({ host: "127.0.0.1", port: frame.port });
        sockets.set(channel, socket);
        socket.on("data", data => { if (!transport.send({ type: "data", channel, data: data.toString("base64") })) { socket.pause(); transport.drain(() => socket.resume()); } });
        socket.on("error", () => socket.destroy());
        socket.on("close", () => { sockets.delete(channel); if (!cleaned) transport.send({ type: "end", channel }); });
      } else if (frame.type === "data") {
        const socket = sockets.get(frame.channel);
        if (!socket) return;
        if (socket.writableLength > 8 * 1024 * 1024) socket.destroy();
        else socket.write(Buffer.from(frame.data, "base64"));
      } else if (frame.type === "end") sockets.get(frame.channel)?.destroy();
    }, disconnect);
    function register() {
      if (ready && !cleaned) transport.send({ type: "broker", value: { type: "register", hostId: hostId, serverUrl: origin, instances: args.broker.listInstances() } });
    }
    let hostId = "";
    const offInstances = args.broker.subscribeInstances(register);
    const offChanged = args.broker.subscribe(event => { if (ready && !cleaned) transport.send({ type: "broker", value: event }); });
    function disconnect() {
      if (cleaned) return;
      cleaned = true;
      clearTimeout(startup);
      offInstances(); offChanged();
      for (const socket of sockets.values()) socket.destroy();
      transport.close();
      worker.stdin.end();
      worker.kill();
      if (child !== worker) return;
      child = null;
      args.broker.setHostId(null);
      if (diagnostics) void args.log(`Browser WSL bridge: ${diagnostics.trim()}`);
      schedule();
    }
    worker.stderr.on("data", (data: Buffer) => { if (diagnostics.length < 4000) diagnostics += data.toString().slice(0, 4000 - diagnostics.length); });
    worker.on("error", error => { diagnostics = error.message; disconnect(); });
    worker.on("exit", disconnect);
  }
  start();
  return {
    reconnect() { generation += 1; if (retry) clearTimeout(retry); retry = null; child?.stdin.end(); child?.kill(); child = null; args.broker.setHostId(null); start(); },
    stop() { stopped = true; generation += 1; if (retry) clearTimeout(retry); retry = null; child?.stdin.end(); child?.kill(); child = null; args.broker.setHostId(null); },
  };
}
