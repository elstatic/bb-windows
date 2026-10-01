import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { connectBaseUrlSchema, connectionSchema, connectionUrl } from "../src/config.js";
import type { ConnectCredential } from "../../../packages/connect-client/src/credential.js";
const { createConnectService, ConnectSignInRequired } = createRequire(import.meta.url)("../dist/connect-service.cjs") as typeof import("../src/connect-service.js");
const config = { kind: "connect" as const, baseUrl: "https://getbb.app/", handle: "second", name: "Second server" };
const machine: ConnectCredential = { serverUrl: "https://seed.getbb.app", handle: "seed", credential: "test-machine-authority" };
const cookie = { domain: ".getbb.app", name: "__Secure-bb-connect.desktop_session", value: "test-desktop-session", expiresAt: Date.now() + 3600000 };
function fixture(fetchImpl: typeof fetch, initial: ConnectCredential | null = machine) {
  let saved = initial;
  let clears = 0;
  let installed: { name: string; value: string; domain: string }[] = [];
  const sets: object[] = [];
  const service = createConnectService({
    getConfig: () => config,
    fetchImpl,
    cache: { canPersist: () => true, read: async () => saved, write: async value => { saved = value; }, clear: async () => { saved = null; clears++; } },
    cookies: {
      get: async filter => installed.filter(cookie => cookie.name === filter.name),
      set: async details => { installed = [...installed.filter(cookie => cookie.name !== details.name), details]; sets.push(details); },
      remove: async (_url, name) => { installed = installed.filter(cookie => cookie.name !== name); },
    },
  });
  return { service, sets, accountCookie: () => { installed.push({ domain: ".getbb.app", name: "__Secure-better-auth.session_token", value: "test-account-cookie" }); }, get clears() { return clears; }, get saved() { return saved; } };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

test("Connect config rejects credentials, unsafe protocols and forged handles", () => {
  assert.equal(connectionUrl(connectionSchema.parse(config)), "https://second.getbb.app/");
  for (const baseUrl of ["http://getbb.app/", "https://user:password@getbb.app/", "https://getbb.app/path", "https://getbb.app/?token=secret"]) assert.equal(connectionSchema.safeParse({ ...config, baseUrl }).success, false);
  for (const handle of ["../evil", "evil.getbb.app", "@evil", "--port", "seed\n"]) assert.equal(connectionSchema.safeParse({ ...config, handle }).success, false);
  assert.equal(connectBaseUrlSchema.safeParse("http://bb.localhost:8787/").success, true);
});

test("signed-out clients require authentication and do not send requests", async () => {
  const f = fixture(async () => { throw new Error("Unexpected network request"); }, null);
  await f.service.initialize();
  assert.deepEqual(await f.service.list(config.baseUrl), { signedIn: false, servers: [] });
  await assert.rejects(f.service.authenticate(config, () => true), ConnectSignInRequired);
  f.service.stop();
});

test("lists every owned server including the pairing server without exposing credentials", async () => {
  const f = fixture(async (_input, init) => {
    assert.equal(new Headers(init?.headers).get("x-bb-connect-machine"), machine.credential);
    assert.equal(init?.redirect, "error");
    return json({ servers: [{ handle: "seed", name: "Seed", live: true }, { handle: "second", name: "Second", live: false }] });
  });
  await f.service.initialize();
  const result = await f.service.list(config.baseUrl);
  assert.equal(result.servers.length, 2);
  assert.equal(result.servers[0].url, "https://seed.getbb.app");
  assert.equal(JSON.stringify(result).includes(machine.credential), false);
  f.service.stop();
});

test("installs and verifies a secure session, deduplicates calls, and renews on demand", async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return json({ cookie }); });
  await f.service.initialize();
  const [a, b] = await Promise.all([f.service.authenticate(config, () => true), f.service.authenticate(config, () => true)]);
  assert.deepEqual(a, b);
  await f.service.authenticate(config, () => true);
  assert.equal(calls, 1);
  assert.equal(f.sets.length, 1);
  assert.deepEqual(f.sets[0], { domain: cookie.domain, name: cookie.name, value: cookie.value, expirationDate: cookie.expiresAt / 1000, httpOnly: true, path: "/", sameSite: "lax", secure: true, url: "https://second.getbb.app" });
  await f.service.authenticate(config, () => true, true);
  assert.equal(calls, 2);
  f.service.stop();
});

test("revoked machines clear cached authority and require a fresh sign-in", async () => {
  const f = fixture(async () => json({ error: "unauthorized" }, 401));
  await f.service.initialize();
  await assert.rejects(f.service.authenticate(config, () => true), ConnectSignInRequired);
  assert.equal(f.clears, 1);
  assert.equal(f.saved, null);
  assert.equal(f.sets.length, 0);
  f.service.stop();
});

test("a cancelled connection cannot install a late session cookie", async () => {
  let finish!: (response: Response) => void;
  const f = fixture(async () => new Promise<Response>(resolve => { finish = resolve; }));
  await f.service.initialize();
  const pending = f.service.authenticate(config, () => true);
  f.service.reset();
  finish(json({ cookie }));
  await assert.rejects(pending, /Connection changed/);
  assert.equal(f.sets.length, 0);
  f.service.stop();
});

test("rejects service responses that try to install another domain's cookie", async () => {
  const f = fixture(async () => json({ cookie: { ...cookie, domain: ".evil.example" } }));
  await f.service.initialize();
  await assert.rejects(f.service.authenticate(config, () => true), /обновить сессию/);
  assert.equal(f.sets.length, 0);
  f.service.stop();
});

test("expired or foreign pairing payloads fail before redeeming a credential", async () => {
  const f = fixture(async () => { throw new Error("Unexpected network request"); }, null);
  await f.service.initialize();
  for (const payload of [
    { code: "private-code", apex: "https://other.example", serverUrl: "https://seed.other.example", expiresAt: Date.now() + 60000 },
    { code: "private-code", apex: "https://getbb.app", serverUrl: "https://seed.getbb.app", expiresAt: 1 },
  ]) await assert.rejects(f.service.pair(config.baseUrl, JSON.stringify(payload)), /Код истёк/);
  assert.equal(f.saved, null);
  f.service.stop();
});

test("redeeming a pairing code stores authority but only returns safe server metadata", async () => {
  const f = fixture(async (input, init) => {
    if (String(input).endsWith("redeem-machine")) {
      assert.deepEqual(JSON.parse(String(init?.body)), { code: "one-use-code", deviceName: "BB Windows" });
      return json({ credential: "test-issued-machine", machineId: "machine-test", serverUrl: "https://seed.getbb.app" });
    }
    return json({ servers: [{ handle: "seed", name: "Seed", live: true }] });
  }, null);
  await f.service.initialize();
  const result = await f.service.pair(config.baseUrl, "one-use-code");
  assert.equal(f.saved?.credential, "test-issued-machine");
  assert.equal(JSON.stringify(result).includes("test-issued-machine"), false);
  await f.service.logout(config.baseUrl);
  assert.equal(f.saved, null);
  assert.equal(f.service.status().sessionActive, false);
  f.service.stop();
});


test("account sign-in authenticates only a server owned by that account", async () => {
  let minted = 0;
  const f = fixture(async (input, init) => {
    assert.equal(new Headers(init?.headers).get("cookie"), "__Secure-better-auth.session_token=test-account-cookie");
    if (String(input).endsWith("/servers")) return json({ servers: [{ handle: "seed", name: "Seed", live: true }] });
    minted++; return json({ cookie });
  }, null);
  await f.service.initialize();
  f.accountCookie();
  await assert.rejects(f.service.authenticate(config, () => true), ConnectSignInRequired);
  assert.equal(minted, 0);
  assert.equal(f.sets.length, 0);
  f.service.stop();
});

test("account cookie login installs and renews the official desktop session", async () => {
  let minted = 0;
  const f = fixture(async (input, init) => {
    assert.equal(new Headers(init?.headers).get("cookie"), "__Secure-better-auth.session_token=test-account-cookie");
    if (String(input).endsWith("/servers")) return json({ servers: [{ handle: config.handle }] });
    minted++; return json({ cookie });
  }, null);
  await f.service.initialize(); f.accountCookie();
  await f.service.authenticate(config, () => true);
  await f.service.authenticate(config, () => true, true);
  assert.equal(minted, 2);
  assert.equal(f.sets.length, 2);
  await f.service.logout(config.baseUrl);
  await assert.rejects(f.service.authenticate(config, () => true), ConnectSignInRequired);
  f.service.stop();
});
