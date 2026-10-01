import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { startClientControl, requestClientControl } from "../src/client-control.js";

test("runtime control rejects an unauthenticated caller and cleans up its descriptor", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bb-client-control-"));
  let called = 0;
  const control = await startClientControl(directory, async () => { called++; return { paired: true }; });
  try {
    const descriptor = JSON.parse(await readFile(join(directory, "client-control.json"), "utf8"));
    const rejected = await new Promise<string>((resolve, reject) => {
      const socket = connect(descriptor.endpoint);
      let output = "";
      socket.on("error", reject);
      socket.on("connect", () => socket.write(JSON.stringify({ token: "wrong-token", request: { action: "status" } }) + "\n"));
      socket.on("data", data => { output += data.toString(); });
      socket.on("end", () => resolve(output));
    });
    assert.equal(JSON.parse(rejected).ok, false);
    assert.equal(called, 0);
    assert.deepEqual(await requestClientControl(directory, { action: "status" }), { paired: true });
    assert.equal(called, 1);
  } finally {
    await control.close();
    await assert.rejects(readFile(join(directory, "client-control.json")));
    await rm(directory, { recursive: true, force: true });
  }
});
