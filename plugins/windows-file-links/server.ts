import { createHash } from "node:crypto";
import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { hostContract, MAX_BYTES, prepareInput, rpcContract } from "./contract.ts";
import { contained, mapPath, normalizeSource } from "./paths.ts";

const mappingsSchema = z.array(z.object({ sourceHostId: z.string(), clientHostId: z.string(), sourceRoot: z.string().startsWith("/"), localRoot: z.string().startsWith("/") }).strict());
export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({ mappings: { type: "string", label: "Synced folder mappings (JSON)", default: "[]" } });
  const host = bb.hosts.experimental_client({ contract: hostContract });
  async function prepare(input: z.infer<typeof prepareInput>) {
    const path = normalizeSource(input.path);
    const storageThreadId = /\/thread-storage\/(thr_[a-zA-Z0-9]+)\//u.exec(path)?.[1];
    let rootPath: string;
    let sourceHostId: string;
    if (storageThreadId) {
      const storage = await bb.sdk.threads.storageLocation({ threadId: storageThreadId });
      rootPath = storage.storageRootPath;
      sourceHostId = storage.hostId;
    } else {
      const thread = await bb.sdk.threads.get({ threadId: input.threadId, include: "environment" });
      if (!("environment" in thread) || !thread.environment?.path || !thread.environment.hostId) throw new Error("Не удалось определить машину и папку файла.");
      rootPath = thread.environment.path;
      sourceHostId = thread.environment.hostId;
    }
    if (!contained(rootPath, path)) throw new Error("Файл находится вне хранилища треда или рабочей папки.");
    if (sourceHostId === input.clientHostId) return { path, source: "original" as const };
    const file = await bb.sdk.files.read({ hostId: sourceHostId, rootPath, path });
    const bytes = Buffer.from(file.content, file.contentEncoding === "utf8" ? "utf8" : "base64");
    if (file.sizeBytes > MAX_BYTES || bytes.length !== file.sizeBytes) throw new Error("Файл слишком большой или получен не полностью (максимум 32 МБ).");
    const mappings = mappingsSchema.parse(JSON.parse((await settings.get()).mappings));
    return host.call("materialize", { sourceHostId, sourcePath: path, content: bytes.toString("base64"), sha256: createHash("sha256").update(bytes).digest("hex"), candidatePath: mapPath(sourceHostId, input.clientHostId, path, mappings) }, { hostId: input.clientHostId });
  }
  bb.rpc.register(rpcContract, { prepare });
  bb.cli.register({ name: "windows-file-links", summary: "Prepare a verified local copy of a remote BB file", commands: [{ name: "prepare", summary: "Download or locate a file on a client host", usage: "bb windows-file-links prepare <path> <thread-id> <client-host-id> [--json]" }], async run(argv) {
    const [command, path, threadId, clientHostId] = argv.filter(v => v !== "--json");
    if (command !== "prepare") return { exitCode: 1, stderr: "Usage: bb windows-file-links prepare <path> <thread-id> <client-host-id> [--json]" };
    const result = await prepare(prepareInput.parse({ path, threadId, clientHostId }));
    return { exitCode: 0, stdout: argv.includes("--json") ? JSON.stringify(result) : result.path };
  } });
}
