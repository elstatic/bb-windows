import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { MAX_BYTES } from "./contract.ts";

export const digest = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
export async function materialize(dataDir: string, input: { sourceHostId: string; sourcePath: string; content: string; sha256: string; candidatePath: string | null }) {
  const bytes = Buffer.from(input.content, "base64");
  if (bytes.length > MAX_BYTES || digest(bytes) !== input.sha256) throw new Error("File transfer checksum or size mismatch.");
  if (input.candidatePath) {
    try {
      const info = await stat(input.candidatePath);
      if (info.isFile() && info.size === bytes.length && digest(await readFile(input.candidatePath)) === input.sha256) return { path: input.candidatePath, source: "synced" as const };
    } catch {}
  }
  const key = digest(`${input.sourceHostId}\0${input.sourcePath}`).slice(0, 32);
  const directory = join(dataDir, "files", key);
  const filename = basename(input.sourcePath).replace(/[<>:"\\|?*\u0000-\u001f]/gu, "_").replace(/[. ]+$/u, "") || "file";
  const path = join(directory, filename);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(() => {}); }
  return { path, source: "downloaded" as const };
}
