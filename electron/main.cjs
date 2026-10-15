"use strict";

const { app, BrowserWindow, ipcMain, Menu, protocol, screen, session, shell } = require("electron");
const { readFile } = require("node:fs/promises");
const { join, resolve, sep } = require("node:path");
const { createNativeService } = require("./native.cjs");

const APP_URL = "softconnect://app/index.html";
const CLIENT_DOWNLOAD_URL = "https://www.virtualhere.com/usb_client_software";
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

function handle(channel, operation, shouldNotify = () => false) {
  ipcMain.handle(`softconnect:${channel}`, async (event, ...args) => {
    if (!isMainFrame(event)) throw new Error("Request was not sent by SoftConnect");
    const result = await operation(...args);
    if (shouldNotify(args, result)) {
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
  handle("command", (command) => service.sendCommand(command), ([command], result) =>
    result?.available === true && !["device-info", "server-info"].includes(command?.action));
  handle("server-log", () => service.readServerLog());
  handle("open-server", () => service.openApp("server"), (_args, result) => result?.opened === true);
  handle("open-client", () => service.openApp("client"), (_args, result) => result?.opened === true);
  handle("client-download", () => shell.openExternal(CLIENT_DOWNLOAD_URL));
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
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1420, workArea.width);
  const height = Math.min(900, workArea.height);
  mainWindow = new BrowserWindow({
    title: "SoftConnect",
    width,
    height,
    minWidth: Math.min(960, width),
    minHeight: Math.min(640, height),
    show: false,
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
      devTools: !app.isPackaged,
    },
  });

  const window = mainWindow;
  window.once("ready-to-show", () => { if (!window.isDestroyed()) window.show(); });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.loadURL(APP_URL).catch((error) => {
    console.error("SoftConnect could not load its local interface:", error);
    if (!window.isDestroyed()) window.show();
  });
}

app.whenReady().then(() => {
  registerAssetProtocol();
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "file://*/*"] },
    (_details, callback) => callback({ cancel: true }),
  );
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
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
