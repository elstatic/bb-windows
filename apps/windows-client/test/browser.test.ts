import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { connect } from "node:net";
import { WebSocketServer } from "ws";
import { once } from "node:events";
import { browserFrameSchema, createBrowserTransport, windowsPathToWsl, type BrowserFrame } from "../src/browser-transport.js";

test("rejects malformed bridge frames and preserves binary payloads", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const received: BrowserFrame[] = [];
  const failures: Error[] = [];
  const transport = createBrowserTransport(input, output, frame => received.push(frame), error => failures.push(error));
  const data = Buffer.from([0, 255, 13, 10, 128]);
  input.write(JSON.stringify({ type: "data", channel: "d6416a23-53ee-4a08-b162-06aee6d28a8b", data: data.toString("base64") }) + "\n");
  input.write('{"type":"open","channel":"bad","port":80}\n');
  input.write('not-json\n');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(received.length, 1);
  assert.equal(received[0].type, "data");
  if (received[0].type === "data") assert.deepEqual(Buffer.from(received[0].data, "base64"), data);
  assert.equal(failures.length, 2);
  transport.close();
  input.destroy(); output.destroy();
});

test("maps Windows installation paths without shell interpolation", () => {
  assert.equal(windowsPathToWsl("C:\\Users\\A B\\app$\\bridge.cjs"), "/mnt/c/Users/A B/app$/bridge.cjs");
  assert.throws(() => windowsPathToWsl("\\\\server\\share\\bridge.cjs"));
  assert.equal(browserFrameSchema.safeParse({ type: "open", channel: "d6416a23-53ee-4a08-b162-06aee6d28a8b", port: 65536 }).success, false);
});

test("WSL bridge authenticates, relays binary CDP traffic, expires and shuts down", { skip: process.platform === "win32", timeout: 10000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), "bb-browser-relay-"));
  const daemon = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(daemon, "listening");
  const address = daemon.address();
  assert.ok(typeof address === "object" && address);
  const token = "b".repeat(64);
  const directory = join(home, ".bb-machines", "bb.test");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "desktop-browser-broker.json"), JSON.stringify({ version: 1, hostId: "host_test", serverUrl: "https://bb.test", url: `ws://127.0.0.1:${address.port}/desktop-browser`, token }), { mode: 0o600 });
  const child = spawn(process.execPath, [resolve("dist/wsl-browser-helper.cjs"), "https://bb.test"], { env: { ...process.env, HOME: home } });
  const exited = once(child, "exit");
  const lines = createInterface({ input: child.stdout });
  const frames: BrowserFrame[] = [];
  const notifications = new PassThrough();
  lines.on("line", line => { frames.push(browserFrameSchema.parse(JSON.parse(line))); notifications.emit("frame"); });
  async function next(type: BrowserFrame["type"]) {
    for (;;) { const index = frames.findIndex(frame => frame.type === type); if (index >= 0) return frames.splice(index, 1)[0]; await once(notifications, "frame"); }
  }
  const connected = once(daemon, "connection");
  let relaySocket: ReturnType<typeof connect> | undefined;
  try {
    const [peer, request] = await connected;
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    assert.deepEqual(await next("ready"), { type: "ready", hostId: "host_test", serverUrl: "https://bb.test" });
    const registration = once(peer, "message");
    child.stdin.write(JSON.stringify({ type: "broker", value: { type: "register", hostId: "host_test", serverUrl: "https://bb.test", instances: [] } }) + "\n");
    assert.equal(JSON.parse((await registration)[0].toString()).type, "register");
    const response = once(peer, "message");
    const endpoint = `ws://127.0.0.1:43210/cdp/${"a".repeat(64)}`;
    child.stdin.write(JSON.stringify({ type: "broker", value: { type: "result", requestId: "req_test", result: { wsEndpoint: endpoint, expiresAt: Date.now() + 700 } } }) + "\n");
    const rewritten = JSON.parse((await response)[0].toString());
    const url = new URL(rewritten.result.wsEndpoint);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.pathname, new URL(endpoint).pathname);
    assert.notEqual(url.port, "43210");
    relaySocket = connect({ host: url.hostname, port: Number(url.port) });
    await once(relaySocket, "connect");
    const opened = await next("open");
    assert.equal(opened.type, "open");
    if (opened.type !== "open") throw new Error("Expected open");
    assert.equal(opened.port, 43210);
    const payload = Buffer.from([1, 0, 255, 10, 128]);
    relaySocket.write(payload);
    const sent = await next("data");
    assert.equal(sent.type, "data");
    if (sent.type === "data") assert.deepEqual(Buffer.from(sent.data, "base64"), payload);
    const returned = once(relaySocket, "data");
    child.stdin.write(JSON.stringify({ type: "data", channel: opened.channel, data: payload.toString("base64") }) + "\n");
    assert.deepEqual((await returned)[0], payload);
    await once(relaySocket, "close");
    const denied = connect({ host: url.hostname, port: Number(url.port) });
    assert.equal(((await once(denied, "error"))[0] as NodeJS.ErrnoException).code, "ECONNREFUSED");
    child.stdin.end();
    await exited;
    assert.equal(child.exitCode, 0);
  } finally {
    relaySocket?.destroy(); child.kill(); lines.close(); notifications.destroy();
    for (const peer of daemon.clients) peer.terminate();
    await new Promise<void>(resolve => daemon.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  }
});
