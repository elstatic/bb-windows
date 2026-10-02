import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { parseFileLink } from "./links.ts";

type Bridge = {
  bbWindowsFiles?: { copy(path: string): Promise<unknown>; reveal(path: string): Promise<unknown> };
  bbDesktop?: { browser?: { getTarget(): Promise<{ hostId: string } | null> } };
};

export default definePluginApp(app => {
  app.contentScripts.register({ id: "windows-file-menu", mount({ signal, pluginId }) {
    const bridge = window as Window & Bridge;
    if (!bridge.bbWindowsFiles) return;
    let menu: HTMLDivElement | null = null;
    let notice: HTMLDivElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let previousFocus: HTMLElement | null = null;
    const close = () => { menu?.remove(); menu = null; previousFocus?.focus(); previousFocus = null; };
    const notify = (message: string, error = false) => {
      notice?.remove(); clearTimeout(timer);
      notice = document.createElement("div");
      notice.setAttribute("role", error ? "alert" : "status");
      notice.textContent = message;
      notice.style.cssText = "position:fixed;bottom:24px;right:24px;max-width:420px;padding:12px 16px;background:var(--background);color:var(--foreground);border:1px solid var(--border);border-radius:12px;z-index:2147483647;box-shadow:0 4px 24px #0002";
      document.body.append(notice);
      timer = setTimeout(() => { notice?.remove(); notice = null; }, error ? 9000 : 3500);
    };
    async function localPath(path: string, threadId: string | null) {
      if (!path.startsWith("/")) return path;
      if (!threadId) throw new Error("Откройте ссылку из треда BB, чтобы определить машину файла.");
      const target = await bridge.bbDesktop?.browser?.getTarget();
      if (!target) throw new Error("Не выбрана локальная машина браузера Windows. Проверьте настройки приложения.");
      const response = await fetch(`/api/v1/plugins/${encodeURIComponent(pluginId)}/rpc/prepare`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, threadId, clientHostId: target.hostId }), signal });
      const envelope: unknown = await response.json();
      const result = typeof envelope === "object" && envelope !== null && "result" in envelope ? envelope.result : null;
      const problem = typeof envelope === "object" && envelope !== null && "error" in envelope ? envelope.error : null;
      if (!response.ok) throw new Error(typeof problem === "object" && problem !== null && "message" in problem && typeof problem.message === "string" ? problem.message : "Не удалось получить локальную копию файла.");
      if (typeof result !== "object" || result === null || !("path" in result) || typeof result.path !== "string") throw new Error("Некорректный ответ плагина.");
      return result.path;
    }
    const contextmenu = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!/^(?:file:|[A-Za-z]:[\\/]|\\\\)/iu.test(href)) return;
      const path = parseFileLink(href);
      if (!path) return;
      event.preventDefault(); event.stopImmediatePropagation(); close();
      const threadId = /\/thread-storage\/(thr_[a-zA-Z0-9]+)\//u.exec(path)?.[1] ?? /\/threads\/(thr_[a-zA-Z0-9]+)/u.exec(location.pathname)?.[1] ?? null;
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      menu = document.createElement("div"); menu.setAttribute("role", "menu");
      menu.dataset.windowsFileLinks = "true";
      menu.style.cssText = "position:fixed;min-width:220px;padding:6px;background:var(--background);color:var(--foreground);border:1px solid var(--border);border-radius:12px;box-shadow:0 4px 24px #0002;z-index:2147483646";
      const add = (label: string, action: () => void | Promise<unknown>) => {
        const item = document.createElement("button"); item.type = "button"; item.setAttribute("role", "menuitem"); item.textContent = label;
        item.style.cssText = "display:block;width:100%;text-align:left;border:0;border-radius:6px;background:transparent;color:inherit;padding:8px 12px;font:inherit;cursor:pointer";
        item.onmouseenter = () => item.focus();
        item.onfocus = () => { item.style.background = "var(--accent)"; };
        item.onblur = () => { item.style.background = "transparent"; };
        item.onclick = () => { close(); Promise.resolve().then(action).catch(error => { if (!signal.aborted) notify(error instanceof Error ? error.message : String(error), true); }); };
        menu!.append(item);
      };
      add("Показать в проводнике", async () => { notify("Подготавливаю файл на ПК…"); await bridge.bbWindowsFiles!.reveal(await localPath(path, threadId)); notify("Файл открыт в проводнике"); });
      add("Копировать путь для Windows", async () => { notify("Подготавливаю файл на ПК…"); await bridge.bbWindowsFiles!.copy(await localPath(path, threadId)); notify("Windows-путь скопирован"); });
      add("Открыть предпросмотр", () => anchor.click());
      add("Копировать исходный путь", () => navigator.clipboard.writeText(path));
      add("Копировать имя файла", () => navigator.clipboard.writeText(path.split(/[\\/]/u).at(-1) ?? path));
      document.body.append(menu);
      menu.style.left = `${Math.max(8, Math.min(event.clientX, innerWidth - menu.offsetWidth - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(event.clientY, innerHeight - menu.offsetHeight - 8))}px`;
      menu.querySelector("button")?.focus();
    };
    const pointerdown = (event: PointerEvent) => { if (menu && event.target instanceof Node && !menu.contains(event.target)) close(); };
    const keydown = (event: KeyboardEvent) => {
      if (!menu) return;
      if (event.key === "Escape" || event.key === "Tab") { close(); event.preventDefault(); }
      else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); const items = Array.from(menu.querySelectorAll("button")); const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const index = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[index]?.focus();
      }
    };
    window.addEventListener("contextmenu", contextmenu, { capture: true, signal });
    window.addEventListener("pointerdown", pointerdown, { capture: true, signal });
    window.addEventListener("keydown", keydown, { capture: true, signal });
    window.addEventListener("blur", close, { signal });
    window.addEventListener("resize", close, { signal });
    window.addEventListener("scroll", close, { capture: true, signal });
    return () => { close(); notice?.remove(); clearTimeout(timer); };
  } });
});
