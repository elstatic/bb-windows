import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createUpdateService } from "../src/update-service.js";

class FakeUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowPrerelease = true;
  allowDowngrade = true;
  checks = 0;
  installs = 0;
  result: () => Promise<{ downloadPromise?: Promise<unknown> } | null> = async () => null;
  async checkForUpdates() { this.checks += 1; return this.result(); }
  quitAndInstall() { this.installs += 1; }
}
function fixture(enabled = true) {
  const updater = new FakeUpdater();
  const service = createUpdateService({ updater, version: "0.3.0", enabled, changed: () => {}, log: () => {} });
  return { updater, service };
}
test("deduplicates concurrent checks and never installs an unverified download", async () => {
  const { updater, service } = fixture();
  let release!: () => void;
  updater.result = () => new Promise(resolve => { release = () => resolve(null); });
  assert.equal(service.install(), false);
  const first = service.check(), second = service.check();
  assert.equal(first, second);
  release();
  await first;
  assert.equal(updater.checks, 1);
  updater.emit("update-available", { version: "0.4.0" });
  assert.equal(service.install(), false);
  updater.emit("error", new Error("Checksum mismatch"));
  assert.equal(service.getInfo().downloadState, "failed");
  assert.equal(updater.installs, 0);
});
test("keeps a downloaded update ready and installs it only once", async () => {
  const { updater, service } = fixture();
  updater.emit("update-downloaded", { version: "0.4.0" });
  updater.emit("error", new Error("Later network failure"));
  await service.check();
  assert.equal(updater.checks, 0);
  assert.equal(service.getInfo().pendingVersion, "0.4.0");
  assert.equal(service.getInfo().downloadState, "downloaded");
  assert.equal(service.install(), true);
  assert.equal(service.install(), false);
  assert.equal(updater.installs, 1);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(updater.allowPrerelease, false);
});
test("network failure is retryable and dev builds or stopped clients cannot install", async () => {
  const { updater, service } = fixture();
  updater.result = async () => { throw new Error("Offline"); };
  assert.equal((await service.check()).downloadState, "failed");
  updater.result = async () => { updater.emit("update-not-available", { version: "0.3.0" }); return null; };
  assert.equal((await service.check()).downloadState, "idle");
  service.stop();
  updater.emit("update-downloaded", { version: "0.4.0" });
  assert.equal(service.install(), false);
  const dev = fixture(false);
  await dev.service.check();
  dev.updater.emit("update-downloaded", { version: "0.4.0" });
  assert.equal(dev.service.install(), false);
  assert.equal(dev.updater.checks, 0);
});
