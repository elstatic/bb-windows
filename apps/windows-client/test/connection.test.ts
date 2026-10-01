import { test } from "node:test";
import assert from "node:assert/strict";
import { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
import { createConnection, type ConnectionState, type ProbeResult } from "../src/connection.js";
import { DEFAULT_CONNECTION } from "../src/config.js";

function harness(results: ProbeResult[], options: { portAvailable?: boolean; closeImmediately?: boolean } = {}) {
  const states: ConnectionState[] = [];
  let launches = 0;
  let kills = 0;
  let clock = 0;
  let lastProcess: ChildProcess | null = null;
  const connection = createConnection(state => states.push(state), async () => results.shift() ?? { kind: "compatible" }, {
    portAvailable: async () => options.portAvailable ?? true,
    launch: () => {
      launches += 1;
      const child = new ChildProcess();
      child.stderr = new PassThrough();
      child.kill = () => { kills += 1; Object.defineProperty(child, "exitCode", { value: 0, configurable: true }); child.emit("close", 0); return true; };
      lastProcess = child;
      if (options.closeImmediately) queueMicrotask(() => { child.stderr?.emit("data", "Permission denied (publickey)."); Object.defineProperty(child, "exitCode", { value: 255, configurable: true }); child.emit("close", 255); });
      return child;
    },
    now: () => clock,
    delay: async ms => { clock += ms; },
    startupTimeoutMs: 1000,
  });
  return { connection, states, get launches() { return launches; }, get kills() { return kills; }, get process() { return lastProcess; } };
}
const unavailable: ProbeResult = { kind: "unavailable", reason: "ECONNREFUSED" };
test("uses a healthy existing tunnel without taking ownership", async () => {
  const h = harness([{ kind: "compatible" }]);
  assert.equal(await h.connection.configure(DEFAULT_CONNECTION), true);
  assert.equal(h.states.at(-1)?.borrowed, true);
  await h.connection.stop();
  assert.equal(h.launches, 0);
  assert.equal(h.kills, 0);
});
test("starts one tunnel, reuses it, and stops only its owned process", async () => {
  const h = harness([unavailable, { kind: "compatible" }]);
  assert.equal(await h.connection.configure(DEFAULT_CONNECTION), true);
  await Promise.all([h.connection.ensure(), h.connection.ensure()]);
  assert.equal(h.launches, 1);
  await h.connection.stop();
  assert.equal(h.kills, 1);
});
test("does not attach BB privileges to another service on the chosen port", async () => {
  const h = harness([{ kind: "incompatible", reason: "Not a BB server" }]);
  assert.equal(await h.connection.configure(DEFAULT_CONNECTION), false);
  assert.equal(h.launches, 0);
  assert.match(h.states.at(-1)?.message ?? "", /Not a BB/);
});
test("reports an occupied port without launching SSH", async () => {
  const h = harness([unavailable], { portAvailable: false });
  assert.equal(await h.connection.configure(DEFAULT_CONNECTION), false);
  assert.equal(h.launches, 0);
  assert.match(h.states.at(-1)?.message ?? "", /38896.*занят/);
});
test("reports SSH authentication errors and retries on the next attempt", async () => {
  const h = harness([unavailable, unavailable], { closeImmediately: true });
  assert.equal(await h.connection.configure(DEFAULT_CONNECTION), false);
  assert.match(h.states.at(-1)?.message ?? "", /Permission denied/);
  assert.equal(await h.connection.ensure(), true);
  await h.connection.stop();
});
test("restores an owned tunnel after its SSH process exits", async () => {
  const h = harness([unavailable, { kind: "compatible" }, unavailable, { kind: "compatible" }]);
  await h.connection.configure(DEFAULT_CONNECTION);
  h.process?.emit("close", 255);
  assert.equal(h.connection.connected, false);
  assert.equal(h.states.at(-1)?.kind, "disconnected");
  await h.connection.ensure();
  assert.equal(h.launches, 2);
  assert.equal(h.states.at(-1)?.kind, "connected");
  await h.connection.stop();
});
test("direct connections never launch an SSH process", async () => {
  const h = harness([unavailable]);
  assert.equal(await h.connection.configure({ kind: "direct", url: "https://bb.example.test/" }), false);
  assert.equal(h.launches, 0);
  await h.connection.stop();
});
test("stopping during a probe cancels the pending connection", async () => {
  let resolveProbe!: (value: ProbeResult) => void;
  let launches = 0;
  const states: ConnectionState[] = [];
  const connection = createConnection(state => states.push(state), () => new Promise(resolve => { resolveProbe = resolve; }), { launch: () => { launches += 1; return new ChildProcess(); } });
  const start = connection.configure(DEFAULT_CONNECTION);
  await new Promise(resolve => setImmediate(resolve));
  const stop = connection.stop();
  resolveProbe(unavailable);
  await Promise.all([start, stop]);
  assert.equal(launches, 0);
  assert.equal(connection.connected, false);
  assert.equal(states.some(state => state.kind === "connected"), false);
});
test("times out an unreachable server and stops the owned SSH process", async () => {
  const h = harness(Array.from({ length: 10 }, () => unavailable));
  assert.equal(await h.connection.configure(DEFAULT_CONNECTION), false);
  assert.equal(h.launches, 1);
  assert.equal(h.kills, 1);
  assert.match(h.states.at(-1)?.message ?? "", /Сервер BB не отвечает/);
  await h.connection.stop();
  assert.equal(h.kills, 1);
});
test("a new configuration cancels the old probe before starting another connection", async () => {
  let release!: (value: ProbeResult) => void;
  let first = true;
  const states: ConnectionState[] = [];
  let launches = 0;
  const connection = createConnection(state => states.push(state), async () => {
    if (first) { first = false; return new Promise(resolve => { release = resolve; }); }
    return { kind: "compatible" };
  }, { launch: () => { launches += 1; return new ChildProcess(); } });
  const initial = connection.configure(DEFAULT_CONNECTION);
  await new Promise(resolve => setImmediate(resolve));
  const replacement = connection.configure({ kind: "direct", url: "https://other.example.test/" });
  release(unavailable);
  assert.equal(await initial, false);
  assert.equal(await replacement, true);
  assert.equal(states.at(-1)?.url, "https://other.example.test/");
  assert.equal(launches, 0);
  await connection.stop();
});
