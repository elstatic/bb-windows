import { z } from "zod";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const sshProfile = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$/);
const port = z.number().int().min(1024).max(65535);
const serverOrigin = z.string().url().refine(value => {
  const url = new URL(value);
  return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/";
}, "Use an HTTP(S) server origin without credentials or a path");
export const connectBaseUrlSchema = serverOrigin.refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" || url.hostname === "localhost" || url.hostname.endsWith(".localhost");
}, "BB Connect requires HTTPS outside localhost");
export const connectHandleSchema = z.string().min(1).max(63).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
export const DEFAULT_CONNECT_BASE_URL = "https://getbb.app/";
const browserHost = z.object({
  distribution: z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/).optional(),
  serverUrl: serverOrigin.optional(),
}).strict().optional();
export const connectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ssh"), profile: sshProfile, localPort: port, remotePort: z.number().int().min(1).max(65535), browserHost }).strict(),
  z.object({ kind: z.literal("direct"), url: serverOrigin, browserHost }).strict(),
  z.object({ kind: z.literal("connect"), baseUrl: connectBaseUrlSchema, handle: connectHandleSchema, name: z.string().min(1).max(256), browserHost }).strict(),
]);
export type ConnectionConfig = z.infer<typeof connectionSchema>;
export const DEFAULT_CONNECTION: ConnectionConfig = { kind: "ssh", profile: "nuc-clawd", localPort: 38896, remotePort: 38886 };
export function connectionUrl(config: ConnectionConfig): string {
  if (config.kind === "connect") { const url = new URL(config.baseUrl); url.hostname = `${config.handle}.${url.hostname}`; return url.origin + "/"; }
  return config.kind === "ssh" ? `http://127.0.0.1:${config.localPort}/` : new URL(config.url).origin + "/";
}
export async function readConnection(path: string): Promise<ConnectionConfig | null> {
  try { return connectionSchema.parse(JSON.parse(await readFile(path, "utf8"))); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw new Error("Saved connection is invalid. Open connection settings to repair it.", { cause: error });
  }
}
export async function saveConnection(path: string, payload: unknown): Promise<ConnectionConfig> {
  const config = connectionSchema.parse(payload);
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + ".tmp";
  await writeFile(temporary, JSON.stringify(config, null, 2));
  await rename(temporary, path);
  return config;
}
