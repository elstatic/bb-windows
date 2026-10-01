import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFileLink, fileActionSchema } from "../src/file-contract.js";
import { createWindowsFileService } from "../src/windows-files.js";

test("parses encoded local file links and line locations without accepting remote URLs or devices", () => {
  assert.equal(parseFileLink("file:///home/me/notes%20%D1%84%D0%B0%D0%B9%D0%BB.md#L12"), "/home/me/notes файл.md");
  assert.equal(parseFileLink("file:///C:/My%20Project/file.md#L3"), "C:\\My Project\\file.md");
  assert.equal(parseFileLink("C:\\work\\file.md:12:3"), "C:\\work\\file.md");
  assert.equal(parseFileLink("file:///tmp/name%23L2"), "/tmp/name#L2");
  for (const path of ["https://example.com/file.md", "file://example.com/file", "relative.md", "\\\\.\\pipe\\secret", "C:\\file:stream", "file:///tmp/a%00b", "//network/file"]) {
    assert.equal(parseFileLink(path), null, path);
    assert.equal(fileActionSchema.safeParse({ action: "file-reveal", path }).success, false, path);
  }
});
test("maps WSL paths through the selected distro and copies or reveals the resulting Windows path", async () => {
  const copied: string[] = [], revealed: string[] = [];
  const service = createWindowsFileService({ distribution: () => "Ubuntu", copy: path => copied.push(path), reveal: path => revealed.push(path), exists: async () => true,
    translate: async (path, distribution) => { assert.equal(distribution, "Ubuntu"); return path.startsWith("/mnt/c/") ? "C:\\work\\файл.md" : "\\\\wsl.localhost\\Ubuntu\\home\\me\\file.md"; },
  });
  await service.execute({ action: "file-copy", path: "/mnt/c/work/файл.md" });
  await service.execute({ action: "file-reveal", path: "file:///home/me/file.md#L3" });
  assert.deepEqual(copied, ["C:\\work\\файл.md"]);
  assert.deepEqual(revealed, ["\\\\wsl.localhost\\Ubuntu\\home\\me\\file.md"]);
});
test("missing files, WSL failures and invalid translator output cannot open Explorer or replace the clipboard", async () => {
  let actions = 0;
  const args = { distribution: () => undefined, copy: () => { actions += 1; }, reveal: () => { actions += 1; } };
  const missing = createWindowsFileService({ ...args, exists: async () => false });
  await assert.rejects(missing.execute({ action: "file-reveal", path: "C:\\not-local.md" }), /другой машине/);
  const failed = createWindowsFileService({ ...args, translate: async () => { throw new Error("No WSL"); } });
  await assert.rejects(failed.execute({ action: "file-copy", path: "/home/file.md" }), /дистрибутив WSL/);
  const invalid = createWindowsFileService({ ...args, translate: async () => "\\\\attacker\\share\\file.md", exists: async () => true });
  await assert.rejects(invalid.execute({ action: "file-reveal", path: "/home/file.md" }), /Windows-путь/);
  assert.equal(actions, 0);
});
