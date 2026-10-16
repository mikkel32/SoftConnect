"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("softconnect", Object.freeze({
  getSnapshot: (options) => ipcRenderer.invoke("softconnect:snapshot", { fresh: options?.fresh === true }),
  getDetailedState: () => ipcRenderer.invoke("softconnect:detailed-state"),
  sendCommand: (command) => ipcRenderer.invoke("softconnect:command", command),
  readServerLog: () => ipcRenderer.invoke("softconnect:server-log"),
  openServer: () => ipcRenderer.invoke("softconnect:open-server"),
  openClient: () => ipcRenderer.invoke("softconnect:open-client"),
  openClientDownload: () => ipcRenderer.invoke("softconnect:client-download"),
  getUpdateStatus: () => ipcRenderer.invoke("softconnect:update-status"),
  checkForUpdates: () => ipcRenderer.invoke("softconnect:update-check"),
  downloadUpdate: () => ipcRenderer.invoke("softconnect:update-download"),
  installUpdate: () => ipcRenderer.invoke("softconnect:update-install"),
  setAutoUpdate: (enabled) => ipcRenderer.invoke("softconnect:update-auto", enabled === true),
  openReleasePage: () => ipcRenderer.invoke("softconnect:update-release-page"),
  onEvent: (callback) => {
    if (typeof callback !== "function") throw new TypeError("Event handler must be a function");
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("softconnect:event", listener);
    return () => ipcRenderer.removeListener("softconnect:event", listener);
  },
}));
