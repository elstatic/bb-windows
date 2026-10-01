import { z } from "zod";
import { connectCredentialSchema, deriveConnectBaseUrl, listAccountServers, redeemMachineCredential, parseMobilePairingPayload, serverUrlForHandle, type ConnectCredential } from "@bb/connect-client";
import { createAccountCookieSource, createCredentialCookieSource, installConnectDesktopSession, type DesktopCookieStore } from "../../desktop/src/connect-desktop-session.js";
import { createConnectSessionRenewal } from "../../desktop/src/connect-session-renewal.js";
import type { ConnectCredentialCache } from "../../desktop/src/connect-credential-cache.js";
import { connectBaseUrlSchema, connectHandleSchema, connectionUrl, type ConnectionConfig } from "./config.js";

export const connectServerSchema = z.object({ handle: connectHandleSchema, name: z.string().min(1).max(256), live: z.boolean() }).strict();
export type ConnectServer = z.infer<typeof connectServerSchema> & { url: string };
interface ConnectCookies extends DesktopCookieStore {
  remove(url: string, name: string): Promise<void>;
}
export class ConnectSignInRequired extends Error {
  constructor() { super("Войдите в BB Connect или подключите устройство по коду."); }
}
export function createConnectService(args: {
  cache: ConnectCredentialCache;
  cookies: ConnectCookies;
  getConfig(): ConnectionConfig | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
  onUnauthorized?(): void;
  onSession?(): void;
}) {
  const now = args.now ?? Date.now;
  const rawFetch = args.fetchImpl ?? globalThis.fetch;
  const fetchImpl: typeof fetch = (input, init) => rawFetch(input, { ...init, redirect: "error", signal: init?.signal ?? AbortSignal.timeout(10000) });
  let credential: ConnectCredential | null = null;
  let generation = 0;
  let sessionOrigin: string | null = null;
  let sessionExpiresAt = 0;
  let pending: { origin: string; generation: number; promise: Promise<{ expiresAt: number; ok: true }> } | null = null;
  const renewal = createConnectSessionRenewal({
    authenticate: async (url, isCurrent) => {
      const config = args.getConfig();
      if (!config || config.kind !== "connect" || new URL(connectionUrl(config)).origin !== new URL(url).origin) return { ok: false, detail: "server changed" };
      try { return await authenticate(config, isCurrent, true); }
      catch (error) { return { ok: false, detail: error instanceof ConnectSignInRequired ? "sign-in required" : "service unavailable" }; }
    },
  });
  const baseFor = (value: string) => new URL(connectBaseUrlSchema.parse(value)).origin;
  function credentialFor(baseUrl: string) {
    return credential && new URL(deriveConnectBaseUrl(credential.serverUrl)).origin === baseFor(baseUrl) ? credential : null;
  }
  function accountCookieName(baseUrl: string) { return new URL(baseUrl).protocol === "https:" ? "__Secure-better-auth.session_token" : "better-auth.session_token"; }
  async function accountCookie(baseUrl: string) {
    const name = accountCookieName(baseUrl);
    return (await args.cookies.get({ name, url: baseFor(baseUrl) })).find(cookie => cookie.name === name);
  }
  async function initialize() {
    credential = await args.cache.read();
    if (credential) {
      try { baseFor(deriveConnectBaseUrl(credential.serverUrl)); connectHandleSchema.parse(credential.handle); }
      catch { credential = null; await args.cache.clear(); }
    }
  }
  async function list(baseUrl: string) {
    const base = baseFor(baseUrl);
    const machine = credentialFor(base);
    let servers: ConnectServer[];
    if (machine) {
      try {
        const result = await listAccountServers(machine, fetchImpl);
        servers = result.servers.map(server => ({ ...connectServerSchema.parse({ handle: server.handle, name: server.name, live: server.live }), url: serverUrlForHandle(base, server.handle) }));
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "unauthorized") {
          credential = null; await args.cache.clear(); args.onUnauthorized?.();
        }
        throw error;
      }
    } else {
      const cookie = await accountCookie(base);
      if (!cookie) return { signedIn: false, servers: [] };
      const response = await fetchImpl(`${base}/api/connect/servers`, { headers: { cookie: `${cookie.name}=${cookie.value}` } });
      if (response.status === 401 || response.status === 403) return { signedIn: false, servers: [] };
      if (!response.ok) throw new Error("BB Connect временно недоступен. Попробуйте ещё раз.");
      const parsed = z.object({ servers: z.array(connectServerSchema) }).parse(await response.json());
      servers = parsed.servers.map(server => ({ ...server, url: serverUrlForHandle(base, server.handle) }));
    }
    return { signedIn: true, servers };
  }
  async function pair(baseUrl: string, input: string) {
    if (!args.cache.canPersist()) throw new Error("Шифрование Windows недоступно: устройство нельзя сохранить.");
    const base = baseFor(baseUrl);
    const payload = parseMobilePairingPayload(input);
    if (payload && (baseFor(payload.apex) !== base || payload.expiresAt <= now() || new URL(deriveConnectBaseUrl(payload.serverUrl)).origin !== base)) throw new Error("Код истёк или относится к другому сервису BB Connect.");
    const next = connectCredentialSchema.parse(await redeemMachineCredential({ apexUrl: base, code: payload?.code ?? input.trim(), deviceName: "BB Windows" }, fetchImpl));
    connectHandleSchema.parse(next.handle);
    await args.cache.write(next);
    credential = next;
    reset();
    return list(base);
  }
  async function authenticate(config: Extract<ConnectionConfig, { kind: "connect" }>, isCurrent: () => boolean, force = false): Promise<{ expiresAt: number; ok: true }> {
    const origin = new URL(connectionUrl(config)).origin;
    if (!force && sessionOrigin === origin && sessionExpiresAt - now() > 5 * 60 * 1000) return { ok: true, expiresAt: sessionExpiresAt };
    const attempt = generation;
    if (pending?.origin === origin && pending.generation === attempt) return pending.promise;
    const promise = (async () => {
      const current = () => attempt === generation && isCurrent();
      const machine = credentialFor(config.baseUrl);
      const cookie = machine ? undefined : await accountCookie(config.baseUrl);
      if (!current()) throw new Error("Connection changed");
      if (!machine && !cookie) throw new ConnectSignInRequired();
      let mintCookie;
      if (machine) mintCookie = createCredentialCookieSource({ credential: machine, fetchImpl });
      else if (cookie) mintCookie = createAccountCookieSource({ accountCookie: cookie, remoteServerUrl: origin, targetHandle: config.handle, fetchImpl });
      else throw new ConnectSignInRequired();
      const result = await installConnectDesktopSession({
        remoteServerUrl: origin, mintCookie,
        cookieStore: {
          get: filter => args.cookies.get(filter),
          set: async details => {
            if (!current()) throw new Error("Connection changed");
            const cookieDomain = details.domain.replace(/^\./, "");
            const base = new URL(config.baseUrl).hostname;
            if (cookieDomain !== base || details.name !== (new URL(origin).protocol === "https:" ? "__Secure-bb-connect.desktop_session" : "bb-connect.desktop_session")) throw new Error("Invalid BB Connect session cookie");
            await args.cookies.set(details);
          },
        },
      });
      if (!current()) throw new Error("Connection changed");
      if (!result.ok) {
        if (result.code === "unauthorized") {
          if (machine) { credential = null; await args.cache.clear(); }
          args.onUnauthorized?.();
          throw new ConnectSignInRequired();
        }
        throw new Error("Не удалось обновить сессию BB Connect. Попробуйте ещё раз.");
      }
      sessionOrigin = origin; sessionExpiresAt = result.expiresAt;
      renewal.start({ expiresAt: result.expiresAt, remoteServerUrl: origin });
      args.onSession?.();
      return { ok: true as const, expiresAt: result.expiresAt };
    })();
    pending = { origin, generation: attempt, promise };
    try { return await promise; } finally { if (pending?.promise === promise) pending = null; }
  }
  function reset() { generation += 1; sessionOrigin = null; sessionExpiresAt = 0; renewal.stop(); }
  async function logout(baseUrl: string) {
    const base = baseFor(baseUrl);
    reset();
    if (credentialFor(base)) { credential = null; await args.cache.clear(); }
    for (const name of [accountCookieName(base), new URL(base).protocol === "https:" ? "__Secure-bb-connect.desktop_session" : "bb-connect.desktop_session"]) {
      const cookies = await args.cookies.get({ name, url: base });
      for (const cookie of cookies) await args.cookies.remove(base, cookie.name);
    }
  }
  async function useAccountSession() { reset(); credential = null; await args.cache.clear(); }
  return { initialize, list, pair, useAccountSession, authenticate, logout, reset, stop: reset, renewIfDue: renewal.renewIfDue, status: () => ({ paired: credential !== null, sessionActive: sessionExpiresAt > now(), sessionExpiresAt: sessionExpiresAt || null }) };
}
