import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { parseFileLink } from "./links.ts";

type Bridge = {
  bbDesktop?: { getInfo(): Promise<{ platform: string }>; browser?: { getTarget(): Promise<{ hostId: string } | null> } };
};

export default definePluginApp(app => {
  app.contentScripts.register({ id: "windows-file-menu", async mount({ signal, pluginId }) {
    const bridge = window as Window & Bridge;
    if (!bridge.bbDesktop || (await bridge.bbDesktop.getInfo()).platform !== "windows" || signal.aborted) return;
    let notice: HTMLDivElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const notify = (message: string, error = false) => {
      notice?.remove(); clearTimeout(timer);
      notice = document.createElement("div");
      notice.setAttribute("role", error ? "alert" : "status");
      notice.textContent = message;
      notice.style.cssText = "position:fixed;bottom:24px;right:24px;max-width:420px;padding:12px 16px;background:var(--background);color:var(--foreground);border:1px solid var(--border);border-radius:12px;z-index:2147483647;box-shadow:0 4px 24px #0002";
      document.body.append(notice);
      timer = setTimeout(() => { notice?.remove(); notice = null; }, error ? 9000 : 3500);
    };
    async function call(method: string, input: unknown) {
      const response = await fetch(`/api/v1/plugins/${encodeURIComponent(pluginId)}/rpc/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), signal });
      const envelope: unknown = await response.json();
      const result = typeof envelope === "object" && envelope !== null && "result" in envelope ? envelope.result : null;
      const problem = typeof envelope === "object" && envelope !== null && "error" in envelope ? envelope.error : null;
      if (!response.ok) throw new Error(typeof problem === "object" && problem !== null && "message" in problem && typeof problem.message === "string" ? problem.message : "Не удалось выполнить действие с файлом.");
      return result;
    }
    async function fileAction(path: string, threadId: string | null, action: "copy" | "reveal") {
      if (!threadId) throw new Error("Откройте ссылку из треда BB, чтобы определить машину файла.");
      const target = await bridge.bbDesktop?.browser?.getTarget();
      const fallback = target ? null : await call("client", null);
      const clientHostId = target?.hostId ?? (typeof fallback === "object" && fallback !== null && "hostId" in fallback && typeof fallback.hostId === "string" ? fallback.hostId : null);
      if (!clientHostId) throw new Error("Выберите Windows / WSL-машину в настройках Windows File Links.");
      await call("action", { path, threadId, clientHostId, action });
    }
    let pending: { path: string; threadId: string | null } | null = null;
    const injected = new Set<HTMLElement>();
    const contextmenu = (event: MouseEvent) => {
      pending = null;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const path = parseFileLink(anchor.getAttribute("href") ?? "");
      if (!path) return;
      const threadId = /\/thread-storage\/(thr_[a-zA-Z0-9]+)\//u.exec(path)?.[1] ?? /\/threads\/(thr_[a-zA-Z0-9]+)/u.exec(location.pathname)?.[1] ?? null;
      pending = { path, threadId };
    };
    const decorate = () => {
      if (!pending) return;
      for (const element of Array.from(document.querySelectorAll<HTMLElement>('[role="menu"]'))) {
        if (element.dataset.windowsFileLinks || !element.isConnected) continue;
        const originals = Array.from(element.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter(item => item.closest('[role="menu"]') === element);
        const copyItem = originals.find(item => /^(Копировать путь к файлу|Copy file path|Copy path)$/iu.test(item.textContent?.trim() ?? ""));
        if (!copyItem) continue;
        const target = { ...pending };
        element.dataset.windowsFileLinks = "true";
        const add = (label: string, action: "copy" | "reveal") => {
          const item = document.createElement("div");
          item.setAttribute("role", "menuitem"); item.tabIndex = -1;
          item.dataset.windowsFileLinksItem = action;
          item.className = copyItem.className; item.textContent = label;
          item.onpointermove = () => { item.focus(); item.dataset.highlighted = ""; };
          item.onpointerleave = () => { delete item.dataset.highlighted; };
          const activate = (event: Event) => {
            event.preventDefault(); event.stopImmediatePropagation();
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
            notify("Подготавливаю файл на ПК…");
            void fileAction(target.path, target.threadId, action).then(() => { if (!signal.aborted) notify(action === "copy" ? "Windows-путь скопирован" : "Файл открыт в проводнике"); }, error => { if (!signal.aborted) notify(error instanceof Error ? error.message : String(error), true); });
          };
          item.onclick = activate;
          item.onkeydown = event => { if (event.key === "Enter" || event.key === " ") activate(event); };
          copyItem.before(item); injected.add(item);
        };
        add("Открыть в проводнике", "reveal");
        add("Копировать путь для Windows", "copy");
      }
      for (const item of injected) if (!item.isConnected) injected.delete(item);
    };
    const observer = new MutationObserver(decorate);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("contextmenu", contextmenu, { capture: true, signal });
    return () => { observer.disconnect(); for (const item of injected) { delete item.parentElement?.dataset.windowsFileLinks; item.remove(); } notice?.remove(); clearTimeout(timer); };
  } });
});
