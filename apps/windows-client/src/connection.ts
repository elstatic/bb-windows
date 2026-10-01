import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { connectionUrl, type ConnectionConfig } from "./config.js";

export type ProbeResult = { kind: "compatible" } | { kind: "unavailable" | "incompatible"; reason: string };
export interface ConnectionState { kind: "connecting" | "connected" | "disconnected"; url: string; message: string; borrowed: boolean }
interface ConnectionDependencies {
  probe(url: string): Promise<ProbeResult>;
  authorize(config: ConnectionConfig, isCurrent: () => boolean): Promise<void>;
  portAvailable(port: number): Promise<boolean>;
  launch(executable: string, args: string[]): ChildProcess;
  sshExecutable: string;
  delay(ms: number): Promise<void>;
  now(): number;
  startupTimeoutMs: number;
}
export function sshArguments(config: Extract<ConnectionConfig, { kind: "ssh" }>): string[] {
  return ["-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-o", "ConnectTimeout=8", "-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=2", "-N", "-L", `127.0.0.1:${config.localPort}:127.0.0.1:${config.remotePort}`, config.profile];
}
export async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}
export function createConnection(
  onState: (state: ConnectionState) => void,
  probe: ConnectionDependencies["probe"],
  overrides: Partial<ConnectionDependencies> = {},
) {
  const deps: ConnectionDependencies = {
    probe, authorize: async () => {}, portAvailable: isPortAvailable,
    launch: (executable, args) => spawn(executable, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] }),
    sshExecutable: process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "OpenSSH", "ssh.exe") : "ssh",
    delay: ms => new Promise(resolve => setTimeout(resolve, ms)), now: Date.now, startupTimeoutMs: 16000, ...overrides,
  };
  let child: ChildProcess | null = null;
  let generation = 0;
  let stopped = false;
  let pending: Promise<boolean> | null = null;
  let config: ConnectionConfig | null = null;
  let lastError = "";
  let connected = false;
  const emit = (kind: ConnectionState["kind"], message: string, borrowed = false) => {
    if (!stopped && config) onState({ kind, message, borrowed, url: connectionUrl(config) });
  };
  async function stopChild() {
    const previous = child;
    child = null;
    if (!previous || previous.exitCode !== null || previous.signalCode !== null) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 2000);
      previous.once("close", () => { clearTimeout(timer); resolve(); });
      previous.kill();
    });
  }
  async function establish(current: ConnectionConfig, attempt: number): Promise<boolean> {
    const isCurrent = () => !stopped && generation === attempt;
    connected = false;
    emit("connecting", "Подключаемся к BB…");
    try {
      await deps.authorize(current, isCurrent);
      if (!isCurrent()) return false;
      let result = await deps.probe(connectionUrl(current));
      if (!isCurrent()) return false;
      if (result.kind === "compatible") {
        connected = true;
        emit("connected", "Подключено", current.kind === "ssh" && child === null);
        return true;
      }
      if (current.kind !== "ssh" || result.kind === "incompatible") throw new Error(result.reason);
      if (child === null) {
        if (!await deps.portAvailable(current.localPort)) throw new Error(`Порт ${current.localPort} занят, но BB на нём не отвечает. Выберите другой порт в настройках.`);
        if (!isCurrent()) return false;
        lastError = "";
        const process = deps.launch(deps.sshExecutable, sshArguments(current));
        child = process;
        process.stderr?.on("data", data => { lastError = (lastError + String(data)).slice(-2048); });
        process.once("error", error => { lastError = error.message; });
        process.once("close", () => {
          if (child !== process) return;
          child = null;
          connected = false;
          if (isCurrent()) emit("disconnected", lastError.trim() || "SSH-соединение закрыто.");
        });
      }
      const deadline = deps.now() + deps.startupTimeoutMs;
      while (isCurrent() && deps.now() < deadline) {
        await deps.delay(400);
        if (!isCurrent()) return false;
        result = await deps.probe(connectionUrl(current));
        if (!isCurrent()) return false;
        if (result.kind === "compatible") {
          connected = true;
          emit("connected", "Подключено");
          return true;
        }
        if (result.kind === "incompatible") throw new Error(result.reason);
        if (lastError && child === null) throw new Error(lastError.trim());
      }
      if (isCurrent()) throw new Error(lastError.trim() || "Сервер BB не отвечает. Проверьте сеть, SSH-профиль и доступность сервера.");
    } catch (error) {
      if (isCurrent()) {
        await stopChild();
        if (isCurrent()) emit("disconnected", error instanceof Error ? error.message : String(error));
      }
    }
    return false;
  }
  return {
    async configure(value: ConnectionConfig) {
      const attempt = ++generation;
      if (pending) await pending;
      if (generation !== attempt) return false;
      await stopChild();
      if (generation !== attempt) return false;
      config = value;
      stopped = false;
      return this.ensure();
    },
    ensure(): Promise<boolean> {
      if (stopped || !config) return Promise.resolve(false);
      if (pending) return pending;
      const attempt = generation;
      pending = establish(config, attempt).finally(() => { pending = null; });
      return pending;
    },
    get connected() { return connected; },
    async stop() {
      stopped = true;
      generation += 1;
      if (pending) await pending;
      await stopChild();
      connected = false;
    },
  };
}
