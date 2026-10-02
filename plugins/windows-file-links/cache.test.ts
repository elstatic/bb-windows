import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest, materialize } from "./cache.ts";
import { contained, mapPath, normalizeSource } from "./paths.ts";
import { parseFileLink } from "./links.ts";

test("server HTML becomes an intact local copy and refreshes when source changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-windows-files-"));
  try {
    const input = { sourceHostId: "server", sourcePath: "/home/clawd/.bb/thread-storage/thr_example/reports/схема.html", content: Buffer.from("<h1>Схема</h1>").toString("base64"), sha256: digest("<h1>Схема</h1>"), candidatePath: null };
    const first = await materialize(root, input);
    assert.equal(first.source, "downloaded"); assert.equal(await readFile(first.path, "utf8"), "<h1>Схема</h1>");
    const second = await materialize(root, { ...input, content: Buffer.from("new").toString("base64"), sha256: digest("new") });
    assert.equal(second.path, first.path); assert.equal(await readFile(first.path, "utf8"), "new");
    await assert.rejects(materialize(root, { ...input, sha256: digest("wrong") }), /checksum/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("synced copy is used only when its contents match; stale copy is preserved", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-windows-files-"));
  try {
    const local = join(root, "existing.html"); await writeFile(local, "fresh");
    const input = { sourceHostId: "server", sourcePath: "/project/existing.html", content: Buffer.from("fresh").toString("base64"), sha256: digest("fresh"), candidatePath: local };
    assert.deepEqual(await materialize(root, input), { path: local, source: "synced" });
    await writeFile(local, "local edits"); assert.equal((await materialize(root, input)).source, "downloaded");
    assert.equal(await readFile(local, "utf8"), "local edits");
    assert.equal((await materialize(root, { ...input, candidatePath: join(root, "missing") })).source, "downloaded");
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("mapping requires both host identities and a contained folder, never matching sibling/traversal", () => {
  const mapping = [{ sourceHostId: "server", clientHostId: "pc", sourceRoot: "/home/clawd/u-POS", localRoot: "/mnt/c/Projects/u-POS" }];
  assert.equal(mapPath("server", "pc", "/home/clawd/u-POS/reports/a.html", mapping), "/mnt/c/Projects/u-POS/reports/a.html");
  assert.equal(mapPath("other", "pc", "/home/clawd/u-POS/reports/a.html", mapping), null);
  assert.equal(mapPath("server", "pc", "/home/clawd/u-POS-other/a.html", mapping), null);
  assert.equal(mapPath("server", "pc", "/home/clawd/u-POS/../secret", mapping), null);
  assert.equal(contained("/thread/thr_x", "/thread/thr_other/a"), false);
  assert.throws(() => normalizeSource("//remote/file")); assert.throws(() => normalizeSource("/tmp/\u0000x"));
  assert.equal(parseFileLink("file:///home/clawd/схема.html#L10"), "/home/clawd/схема.html");
  assert.equal(parseFileLink("file://foreign/share/a"), null);
});
