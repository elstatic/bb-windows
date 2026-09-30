import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, powerMonitor, session, shell, webContents, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { type AppCommandId, type AppKeybindings } from "@bb/domain";
import { createDesktopBrowserViewManager } from "../../desktop/src/desktop-browser-view.js";
import { registerDesktopBrowserIpc } from "../../desktop/src/desktop-browser-main-ipc.js";
import { registerDesktopContextMenu } from "../../desktop/src/desktop-context-menu.js";
import { createLocalViewUrl, STARTUP_ACTION_CHANNEL } from "../../desktop/src/local-view.js";
import { probeBbServer } from "../../desktop/src/server-probe.js";
import { parseDesktopSystemConfig } from "../../desktop/src/desktop-system-config.js";
import { resolveDesktopBrowserAppCommand } from "../../desktop/src/desktop-browser-shortcuts.js";
import { createDesktopFindViewManager } from "../../desktop/src/desktop-find-view.js";
import { DEFAULT_APPLICATION_MENU_ACCELERATORS, resolveApplicationMenuAccelerators } from "../../desktop/src/desktop-menu-shortcuts.js";
import * as desktopIpc from "../../desktop/src/desktop-update-ipc.js";
import * as windowIpc from "../../desktop/src/desktop-window-command-ipc.js";
import * as browserIpc from "../../desktop/src/desktop-browser-ipc.js";
import { bbDesktopBrowserTabRefSchema } from "@bb/desktop-contract";
import { createDesktopBrowserBroker } from "../../desktop/src/desktop-browser-broker.js";
import { createWslBrowserClient } from "./wsl-browser-client.js";
import { connectionSchema, connectionUrl, DEFAULT_CONNECTION, readConnection, saveConnection, type ConnectionConfig } from "./config.js";
import { createConnection, type ConnectionState } from "./connection.js";

const appId = "dev.bb.windows-client";
app.setName("BB Windows");
app.setPath("userData", join(app.getPath("appData"), "BB Windows"));
app.setAppUserModelId(appId);
if (!app.requestSingleInstanceLock()) { app.quit(); }
else { void run().catch(error => {
  dialog.showErrorBox("BB Windows", error instanceof Error ? error.message : String(error));
  app.quit();
}); }

async function run() {
  await app.whenReady();
  const root = __dirname;
  const userData = app.getPath("userData");
  const configPath = join(userData, "connection.json");
  const logPath = join(userData, "client.log");
  await mkdir(userData, { recursive: true });
  const log = async (message: string) => {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(logPath, `${new Date().toISOString()} ${message}\n`).catch(() => {});
  };
  let config: ConnectionConfig | null = null;
  let settings: BrowserWindow | null = null;
  let quitting = false;
  let quitReady = false;
  let smokeStarted = false;
  let generation = 0;
  let stateSequence = 0;
  let keybindings: AppKeybindings = [];
  let accelerators = DEFAULT_APPLICATION_MENU_ACCELERATORS;
  let main: BrowserWindow;
  const windows = new Set<BrowserWindow>();
  const localViews = new Set<string>();
  const info = { platform: "windows", version: app.getVersion(), lastCheckedAt: null, latestVersion: null, pendingVersion: null, updateAvailable: false, updateDownloaded: false, serverDaemonLogsAvailable: false };
  const origin = () => config ? new URL(connectionUrl(config)).origin : null;
  const trusted = (event: IpcMainEvent | IpcMainInvokeEvent) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || !windows.has(window) || event.senderFrame !== event.sender.mainFrame) return false;
    const url = event.sender.getURL();
    return localViews.has(url) || (origin() !== null && url.startsWith(origin() + "/"));
  };
  const openExternal = (value: unknown) => {
    if (typeof value !== "string") return;
    let url: URL;
    try { url = new URL(value); } catch { return; }
    if (["https:", "http:", "mailto:"].includes(url.protocol)) void shell.openExternal(url.href);
  };
  const manager = createDesktopBrowserViewManager({
    pagePreloadPath: join(root, "browser-page-preload.cjs"),
    dispatchAppCommand: ({ command, hostWebContentsId }) => webContents.fromId(hostWebContentsId)?.send(windowIpc.BB_DESKTOP_APP_COMMAND_CHANNEL, command),
    focusHostWebContents: id => webContents.fromId(id)?.focus(),
    resolveAppCommand: input => resolveDesktopBrowserAppCommand({ input, keybindings, isMac: false }),
  });
  const helperPath = join(userData, "wsl-browser-helper.cjs");
  await writeFile(helperPath, await readFile(join(root, "wsl-browser-helper.cjs")));
  const broker = createDesktopBrowserBroker({ manager, product: `Chrome/${process.versions.chrome}` });
  const browserClient = createWslBrowserClient({
    broker, helperPath, log,
    getTarget: () => config ? { serverUrl: config.browserHost?.serverUrl ?? connectionUrl(config), distribution: config.browserHost?.distribution } : null,
  });
  registerDesktopBrowserIpc(manager);
  const findManager = createDesktopFindViewManager({ preloadPath: join(root, "find-bar-preload.cjs") });
  const sendCommand = (command: AppCommandId) => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused && windows.has(focused)) focused.webContents.send(windowIpc.BB_DESKTOP_APP_COMMAND_CHANNEL, command);
  };
  const zoom = (command: unknown) => {
    const focused = webContents.getFocusedWebContents();
    if (!focused) return;
    const value = focused.getZoomFactor();
    if (command === "reset") focused.setZoomFactor(1);
    if (command === "in") focused.setZoomFactor(Math.min(3, value + .1));
    if (command === "out") focused.setZoomFactor(Math.max(.5, value - .1));
  };
  const connection = createConnection(state => { void applyState(state); }, async url => probeBbServer({ serverUrl: url, timeoutMs: 2000 }));
  async function loadLocal(kind: "loading" | "error", title: string, message: string) {
    const url = createLocalViewUrl({ viewModel: kind === "loading" ? { kind, title, message } : {
      kind, title, details: message, logText: "", actions: [{ id: "retry", label: "Повторить" }, { id: "choose-server", label: "Настройки подключения" }],
    } });
    localViews.add(url);
    for (const window of windows) if (!window.isDestroyed()) { manager.prepareWindowReload(window); await window.loadURL(url); }
  }
  async function applyState(state: ConnectionState) {
    const sequence = ++stateSequence;
    await log(`${state.kind} ${state.message}`);
    if (quitting || sequence !== stateSequence) return;
    if (state.kind === "connecting") return;
    if (state.kind === "disconnected") {
      await loadLocal("error", "Не удалось подключиться к BB", state.message);
      return;
    }
    const attempt = ++generation;
    for (const window of windows) {
      if (window.isDestroyed() || new URL(state.url).origin === safeOrigin(window.webContents.getURL())) continue;
      manager.prepareWindowReload(window);
      try { await window.loadURL(state.url); }
      catch (error) {
        if (attempt === generation) await loadLocal("error", "Не удалось открыть BB", error instanceof Error ? error.message : String(error));
      }
    }
    try {
      const response = await fetch(new URL("/api/v1/system/config", state.url), { signal: AbortSignal.timeout(4000) });
      if (attempt !== generation || quitting) return;
      keybindings = parseDesktopSystemConfig(await response.json()).keybindings;
      accelerators = resolveApplicationMenuAccelerators(keybindings);
      installMenu();
    } catch (error) { await log(`Could not refresh shortcuts: ${String(error)}`); }
    const smokeOutput = process.argv.find(value => value.startsWith("--smoke-output="))?.slice("--smoke-output=".length);
    if (smokeOutput && !smokeStarted) {
      smokeStarted = true;
      const delayArgument = process.argv.find(value => value.startsWith("--smoke-delay-ms="))?.slice("--smoke-delay-ms=".length);
      const smokeDelay = z.coerce.number().int().min(1000).max(45000).catch(7000).parse(delayArgument);
      await new Promise(resolve => setTimeout(resolve, smokeDelay));
      const result = await main.webContents.executeJavaScript(`(async () => ({url: location.href, title: document.title, bodyLength: document.body.innerText.length, desktop: await window.bbDesktop.getInfo(), health: await (await fetch('/health')).json(), settings: (await fetch('/api/v1/system/config')).status}))()`);
      await writeFile(smokeOutput, JSON.stringify(result, null, 2));
      const screenshot = await main.webContents.capturePage();
      await writeFile(smokeOutput + ".png", screenshot.toPNG());
      app.quit();
    }
  }
  function safeOrigin(url: string): string | null { try { return new URL(url).origin; } catch { return null; } }
  async function createWindow() {
    const boundsSchema = z.object({ x: z.number().int().optional(), y: z.number().int().optional(), width: z.number().int().min(720).max(10000), height: z.number().int().min(480).max(10000), maximized: z.boolean() });
    let saved: z.infer<typeof boundsSchema> | null = null;
    try { saved = boundsSchema.parse(JSON.parse(await readFile(join(userData, "window.json"), "utf8"))); } catch {}
    const window = new BrowserWindow({ width: saved?.width ?? 1280, height: saved?.height ?? 900, minWidth: 720, minHeight: 480, title: "BB Windows", icon: join(root, "icon.png"), show: false,
      webPreferences: { preload: join(root, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
    });
    windows.add(window);
    broker.registerWindow(window);
    if (saved?.x !== undefined && saved?.y !== undefined) {
      const { screen } = await import("electron");
      const workArea = screen.getDisplayMatching({ x: saved.x, y: saved.y, width: saved.width, height: saved.height }).workArea;
      window.setPosition(Math.max(workArea.x, Math.min(saved.x, workArea.x + workArea.width - 100)), Math.max(workArea.y, Math.min(saved.y, workArea.y + workArea.height - 100)));
    }
    if (saved?.maximized) window.maximize();
    window.once("ready-to-show", () => window.show());
    registerDesktopContextMenu({ webContents: window.webContents });
    window.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: "deny" }; });
    window.webContents.on("will-navigate", (event, url) => { if (safeOrigin(url) !== origin()) { event.preventDefault(); openExternal(url); } });
    window.webContents.on("will-redirect", (event, url) => { if (safeOrigin(url) !== origin()) event.preventDefault(); });
    window.on("resize", () => { manager.endWindowResize(window); findManager.layout(window); });
    window.on("enter-full-screen", () => window.webContents.send(windowIpc.BB_DESKTOP_WINDOW_STATE_CHANGED_CHANNEL, { isFullScreen: true }));
    window.on("leave-full-screen", () => window.webContents.send(windowIpc.BB_DESKTOP_WINDOW_STATE_CHANGED_CHANNEL, { isFullScreen: false }));
    window.on("close", () => { void writeFile(join(userData, "window.json"), JSON.stringify({ ...window.getNormalBounds(), maximized: window.isMaximized() })).catch(() => {}); });
    const contentsId = window.webContents.id;
    window.on("closed", () => { windows.delete(window); broker.releaseWindow(contentsId); manager.releaseWindow(contentsId); findManager.releaseWindow(contentsId); });
    const loading = createLocalViewUrl({ viewModel: { kind: "loading", title: "BB Windows", message: "Подключаемся к серверу…" } });
    localViews.add(loading);
    await window.loadURL(config && connection.connected ? connectionUrl(config) : loading);
    return window;
  }
  function openSettings() {
    if (settings && !settings.isDestroyed()) { settings.focus(); return; }
    settings = new BrowserWindow({ width: 580, height: 840, resizable: false, title: "Подключение к BB", parent: main, modal: true,
      webPreferences: { preload: join(root, "settings-preload.cjs"), sandbox: true, nodeIntegration: false, contextIsolation: true },
    });
    settings.setMenu(null);
    settings.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    settings.webContents.on("will-navigate", event => event.preventDefault());
    settings.on("closed", () => { settings = null; });
    void settings.loadFile(join(root, "settings.html"));
  }
  const trustedSettings = (event: IpcMainInvokeEvent) => settings && event.sender === settings.webContents && event.senderFrame === event.sender.mainFrame && event.sender.getURL() === pathToFileURL(join(root, "settings.html")).href;
  ipcMain.handle("bb-windows:connection-read", event => { if (!trustedSettings(event)) throw new Error("Invalid settings sender"); return config ?? DEFAULT_CONNECTION; });
  ipcMain.handle("bb-windows:connection-save", async (event, payload: unknown) => {
    if (!trustedSettings(event)) throw new Error("Invalid settings sender");
    try {
      config = await saveConnection(configPath, connectionSchema.parse(payload));
      settings?.close();
      browserClient.reconnect();
      void connection.configure(config);
      return { ok: true };
    } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  });
  function installMenu() {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: "BB", submenu: [
        { label: "Подключение…", click: openSettings },
        { label: "Повторить подключение", click: () => { void connection.ensure(); } },
        { label: "Открыть журнал клиента", click: () => { void shell.openPath(logPath); } },
        { label: "О BB Windows", click: () => { void dialog.showMessageBox({ title: "BB Windows", message: `BB Windows ${app.getVersion()}`, detail: "Windows-клиент BB. Обновление: установите новую версию поверх текущей. Управление браузером через локальный WSL-демон. Импорт cookies из Windows-браузеров пока недоступен. Исходный проект: get-bb/bb, MIT.", buttons: ["OK"] }); } },
        { type: "separator" }, { role: "quit", label: "Выход" },
      ] },
      { label: "Файл", submenu: [
        { label: "Новый тред", accelerator: accelerators.openNewThread, click: () => sendCommand("thread.new") },
        { label: "Новая вкладка", accelerator: accelerators.openNewTab, click: () => sendCommand("panel.newTab") },
        { label: "Вернуть закрытую вкладку", accelerator: accelerators.reopenClosedTab, click: () => sendCommand("panel.reopenClosedTab") },
        { label: "Новое окно", accelerator: accelerators.createNewWindow, click: () => { void createWindow(); } },
        { label: "Закрыть вкладку", accelerator: accelerators.closeWindowOrSideTab, click: () => sendCommand("panel.close") },
        { label: "Настройки BB", accelerator: accelerators.openSettings, click: () => sendCommand("settings.open") },
      ] },
      { label: "Правка", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
      { label: "Вид", submenu: [{ role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "togglefullscreen" }] },
      { label: "Окно", submenu: [{ role: "minimize" }, { role: "close" }] },
    ]));
  }
  for (const channel of [desktopIpc.BB_DESKTOP_GET_INFO_CHANNEL, desktopIpc.BB_DESKTOP_CHECK_FOR_UPDATES_CHANNEL]) ipcMain.handle(channel, event => { if (!trusted(event)) return null; return info; });
  ipcMain.handle(desktopIpc.BB_DESKTOP_INSTALL_UPDATE_CHANNEL, () => undefined);
  ipcMain.handle(windowIpc.BB_DESKTOP_GET_WINDOW_STATE_CHANNEL, event => trusted(event) ? { isFullScreen: BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false } : null);
  ipcMain.handle(windowIpc.BB_DESKTOP_OPEN_DATA_DIRECTORY_CHANNEL, event => { if (trusted(event)) return shell.openPath(userData); });
  ipcMain.handle(windowIpc.BB_DESKTOP_OPEN_SERVER_DAEMON_LOGS_CHANNEL, () => undefined);
  ipcMain.on(desktopIpc.BB_DESKTOP_OPEN_EXTERNAL_URL_CHANNEL, (event, value) => { if (trusted(event)) openExternal(value); });
  ipcMain.on(desktopIpc.BB_DESKTOP_ZOOM_COMMAND_CHANNEL, (event, command) => { if (trusted(event)) zoom(command); });
  ipcMain.on(desktopIpc.BB_DESKTOP_SET_THEME_CHANNEL, (event, value) => { if (trusted(event) && ["system", "dark", "light"].includes(value)) nativeTheme.themeSource = value; });
  ipcMain.on(STARTUP_ACTION_CHANNEL, (event, value) => { if (!trusted(event)) return; if (value === "retry") void connection.ensure(); if (value === "choose-server") openSettings(); });
  ipcMain.handle(browserIpc.BB_DESKTOP_BROWSER_TARGET_CHANNEL, event => trusted(event) ? broker.getTarget(event.sender.id) : null);
  ipcMain.handle(browserIpc.BB_DESKTOP_BROWSER_GET_CONTROL_CHANNEL, (event, payload: unknown) => {
    const parsed = bbDesktopBrowserTabRefSchema.safeParse(payload);
    return trusted(event) && parsed.success ? broker.getControl(event.sender.id, parsed.data.tabId) : null;
  });
  ipcMain.on(browserIpc.BB_DESKTOP_BROWSER_RELEASE_CONTROL_CHANNEL, (event, payload: unknown) => {
    const parsed = bbDesktopBrowserTabRefSchema.safeParse(payload);
    if (trusted(event) && parsed.success) broker.takeOver(event.sender.id, parsed.data.tabId);
  });
  ipcMain.handle(browserIpc.BB_DESKTOP_BROWSER_LIST_IMPORT_SOURCES_CHANNEL, () => ({ sources: [] }));
  ipcMain.handle(browserIpc.BB_DESKTOP_BROWSER_IMPORT_COOKIES_CHANNEL, () => ({ ok: false, reason: "unsupportedPlatform" }));
  ipcMain.on(windowIpc.BB_DESKTOP_OPEN_WINDOW_FIND_CHANNEL, (event, payload: unknown) => {
    if (!trusted(event)) return;
    const parsed = z.object({ topOffset: z.number().finite().min(0).max(10000) }).safeParse(payload);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (parsed.success && window) findManager.open(window, parsed.data);
  });
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    const window = BrowserWindow.fromWebContents(contents);
    callback(Boolean(window && windows.has(window) && safeOrigin(contents.getURL()) === origin() && ["notifications", "media", "clipboard-sanitized-write"].includes(permission)));
  });
  main = await createWindow();
  installMenu();
  app.on("second-instance", () => { const target = main.isDestroyed() ? [...windows][0] : main; if (!target) return; if (target.isMinimized()) target.restore(); target.show(); target.focus(); });
  app.on("window-all-closed", () => app.quit());
  const poll = setInterval(() => { if (config && !settings && !quitting) void connection.ensure(); }, 15000);
  powerMonitor.on("resume", () => { if (!quitting) void connection.ensure(); });
  app.on("before-quit", event => {
    if (quitReady) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    generation += 1;
    clearInterval(poll);
    browserClient.stop();
    broker.dispose();
    manager.destroyAll();
    findManager.destroyAll();
    void connection.stop().finally(() => { quitReady = true; app.quit(); });
  });
  try { config = await readConnection(configPath); }
  catch (error) { await loadLocal("error", "Проверьте настройки подключения", error instanceof Error ? error.message : String(error)); }
  if (config) { browserClient.reconnect(); void connection.configure(config); }
  else openSettings();
}
