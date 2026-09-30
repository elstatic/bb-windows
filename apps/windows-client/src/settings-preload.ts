import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("bbConnection", {
  read: () => ipcRenderer.invoke("bb-windows:connection-read"),
  save: (value: unknown) => ipcRenderer.invoke("bb-windows:connection-save", value),
});
