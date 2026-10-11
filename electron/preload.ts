import { contextBridge, ipcRenderer } from "electron";
import type { UpdateStatus } from "./updater";

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  platform: process.platform,

  // Updates: the main process keeps the latest status, so a page that mounts
  // after the startup check reads it with `status()` and follows `onStatus`.
  updates: {
    status: (): Promise<UpdateStatus> => ipcRenderer.invoke("update:status"),
    onStatus: (callback: (status: UpdateStatus) => void) => {
      const handler = (_e: unknown, status: UpdateStatus) => callback(status);
      ipcRenderer.on("update:status", handler);
      return () => ipcRenderer.removeListener("update:status", handler);
    },
    download: () => ipcRenderer.invoke("update:download"),
    install: () => ipcRenderer.invoke("update:install"),
    check: (): Promise<UpdateStatus> => ipcRenderer.invoke("update:check"),
  },

  // Native UDP/TCP MAVLink sockets (the browser sandbox can't open raw sockets).
  net: {
    open: (spec: {
      proto: "udp" | "tcp";
      host: string;
      port: number;
      mode?: "listen" | "target";
    }) => ipcRenderer.invoke("net:open", spec),
    send: (id: string, data: Uint8Array) => ipcRenderer.send("net:send", id, data),
    close: (id: string) => ipcRenderer.invoke("net:close", id),
    onData: (callback: (msg: { id: string; data: Uint8Array }) => void) => {
      const handler = (_e: unknown, msg: { id: string; data: Uint8Array }) =>
        callback(msg);
      ipcRenderer.on("net:data", handler);
      return () => ipcRenderer.removeListener("net:data", handler);
    },
    onClose: (callback: (msg: { id: string; reason?: string }) => void) => {
      const handler = (_e: unknown, msg: { id: string; reason?: string }) =>
        callback(msg);
      ipcRenderer.on("net:close", handler);
      return () => ipcRenderer.removeListener("net:close", handler);
    },
    onPeer: (callback: (msg: { id: string; host: string; port: number }) => void) => {
      const handler = (_e: unknown, msg: { id: string; host: string; port: number }) =>
        callback(msg);
      ipcRenderer.on("net:peer", handler);
      return () => ipcRenderer.removeListener("net:peer", handler);
    },
  },

  // Paired-node API keys are sealed with the OS key store in the main process;
  // the renderer persists only the ciphertext.
  localNodes: {
    encrypt: (key: string): Promise<string | null> =>
      ipcRenderer.invoke("localNodes:encrypt", key),
    decrypt: (sealed: string): Promise<string> =>
      ipcRenderer.invoke("localNodes:decrypt", sealed),
  },
});
