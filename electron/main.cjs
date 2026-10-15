"use strict";

const { app, BrowserWindow, ipcMain, Menu, protocol, session } = require("electron");
const { readFile } = require("node:fs/promises");
const { join, resolve, sep } = require("node:path");
const { createNativeService } = require("./native.cjs");

const APP_URL = "softconnect://app/index.html";
const DIST = resolve(__dirname, "../dist");
const service = createNativeService();
let mainWindow = null;

protocol.registerSchemesAsPrivileged([{
  scheme: "softconnect",
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

const MIME = {
  ".css": "text/css",
  ".html": "text/html",
  ".ico": "image/x-icon",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function contentType(path) {
  const extension = path.slice(path.lastIndexOf("."));
  return MIME[extension] || "application/octet-stream";
}

function isMainFrame(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) return false;
  try {
    const url = new URL(event.senderFrame.url);
    return url.protocol === "softconnect:" && url.hostname === "app";
  } catch {
    return false;
  }
}

function handle(channel, operation, changed = false) {
  ipcMain.handle(`softconnect:${channel}`, async (event, ...args) => {
    if (!isMainFrame(event)) throw new Error("Request was not sent by SoftConnect");
    const result = await operation(...args);
    if (changed && result && (result.available !== false)) {
      mainWindow?.webContents.send("softconnect:event", { type: "state-changed" });
    }
    return result;
  });
}

function registerApi() {
  handle("status", async () => ({
    ...(await service.getStatus()),
    appVersion: app.getVersion(),
    platform: process.platform,
  }));
  handle("state", () => service.getState());
  handle("detailed-state", () => service.getDetailedState());
  handle("command", (command) => service.sendCommand(command), true);
  handle("server-log", () => service.readServerLog());
  handle("open-server", () => service.openApp("server"), true);
  handle("open-client", () => service.openApp("client"), true);
}

function registerAssetProtocol() {
  protocol.handle("softconnect", async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== "app" || /%2f|%5c/i.test(url.pathname)) throw new Error("Invalid app resource");
      const name = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      const path = resolve(DIST, `.${name}`);
      if (path !== DIST && !path.startsWith(`${DIST}${sep}`)) throw new Error("Resource outside app bundle");
      const bytes = await readFile(path);
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": contentType(path),
          "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: "SoftConnect",
    width: 1420,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0b101b",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.loadURL(APP_URL);
}

app.whenReady().then(() => {
  registerAssetProtocol();
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "file://*/*"] },
    (_details, callback) => callback({ cancel: true }),
  );
  registerApi();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "SoftConnect", submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }] },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "close" }] },
  ]));
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
