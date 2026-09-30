import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectionSchema, DEFAULT_CONNECTION, readConnection, saveConnection } from "../src/config.js";
import { sshArguments } from "../src/connection.js";

test("rejects option injection, commands and embedded credentials", () => {
  for (const profile of ["-oProxyCommand=calc", "nuc;calc", "nuc clawd", "nuc\ncalc"]) assert.equal(connectionSchema.safeParse({ ...DEFAULT_CONNECTION, profile }).success, false);
  for (const url of ["file:///C:/Windows/", "javascript:alert(1)", "https://user:password@bb.test/", "https://bb.test/path", "https://bb.test/?token=secret"]) assert.equal(connectionSchema.safeParse({ kind: "direct", url }).success, false);
  assert.equal(sshArguments({ kind: "ssh", profile: "nuc-clawd", localPort: 38896, remotePort: 38886 }).at(-1), "nuc-clawd");
});
test("persists a validated config and distinguishes first launch from corruption", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bb-windows-config-"));
  const file = join(directory, "connection.json");
  try {
    assert.equal(await readConnection(file), null);
    await saveConnection(file, DEFAULT_CONNECTION);
    assert.deepEqual(await readConnection(file), DEFAULT_CONNECTION);
    await assert.rejects(saveConnection(file, { ...DEFAULT_CONNECTION, localPort: 80 }));
    assert.deepEqual(await readConnection(file), DEFAULT_CONNECTION);
    await writeFile(file, "broken json");
    await assert.rejects(readConnection(file), /Saved connection is invalid/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
