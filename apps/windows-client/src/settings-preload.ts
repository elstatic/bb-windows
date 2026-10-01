import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("bbConnection", {
  read: () => ipcRenderer.invoke("bb-windows:connection-read"),
  connect: (value: unknown) => ipcRenderer.invoke("bb-windows:connect-action", value),
  onConnectChanged: (callback: () => void) => { const listener = () => callback(); ipcRenderer.on("bb-windows:connect-changed", listener); return () => ipcRenderer.removeListener("bb-windows:connect-changed", listener); },
  save: (value: unknown) => ipcRenderer.invoke("bb-windows:connection-save", value),
});
