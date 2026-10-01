import "../../desktop/src/preload.js";
import { contextBridge, ipcRenderer } from "electron";
import { parseFileLink } from "./file-contract.js";

contextBridge.exposeInMainWorld("bbWindowsFiles", {
  resolve: (path: string) => ipcRenderer.invoke("bb-windows:file-action", { action: "file-resolve", path }),
  copy: (path: string) => ipcRenderer.invoke("bb-windows:file-action", { action: "file-copy", path }),
  reveal: (path: string) => ipcRenderer.invoke("bb-windows:file-action", { action: "file-reveal", path }),
});
document.addEventListener("contextmenu", event => {
  const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!(anchor instanceof HTMLAnchorElement)) return;
  const path = anchor.getAttribute("href") ?? "";
  if (!/^(?:file:|[A-Za-z]:[\\/]|\\\\)/i.test(path) || !parseFileLink(path)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void ipcRenderer.invoke("bb-windows:file-menu", { path }).then(action => { if (action === "preview" && anchor.isConnected) anchor.click(); }).catch(() => {});
}, true);
