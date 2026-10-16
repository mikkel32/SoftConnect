"use strict";

const { app, BrowserWindow, ipcMain, Menu, protocol, screen, session, shell } = require("electron");
const { readFile } = require("node:fs/promises");
const { join, resolve, sep } = require("node:path");
const { createNativeService, run } = require("./native.cjs");
const { UPDATE_PUBLIC_KEY } = require("./update-key.cjs");
const { createUpdater, filePreferences, macTools } = require("./updater.cjs");

const APP_URL = "softconnect://app/index.html";
const CLIENT_DOWNLOAD_URL = "https://www.virtualhere.com/usb_client_software";
const DIST = resolve(__dirname, "../dist");
// Matches the renderer's --bg token so the window does not flash a different shade while loading.
const BACKGROUND = "#08121b";
const service = createNativeService();
let mainWindow = null;
let updater = null;

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

function handle(channel, operation) {
  ipcMain.handle(`softconnect:${channel}`, async (event, ...args) => {
    if (!isMainFrame(event)) throw new Error("Request was not sent by SoftConnect");
    return operation(...args);
  });
}

// The renderer refreshes after its own commands, so the main process only pushes menu actions.
function sendToRenderer(event) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("softconnect:event", event);
}

function registerApi() {
  handle("snapshot", async (options) => {
    const snapshot = await service.getSnapshot({ fresh: options?.fresh === true });
    return {
      ...snapshot,
      status: snapshot.status && { ...snapshot.status, appVersion: app.getVersion(), platform: process.platform },
    };
  });
  handle("detailed-state", () => service.getDetailedState());
  handle("command", (command) => service.sendCommand(command));
  handle("server-log", () => service.readServerLog());
  handle("open-server", () => service.openApp("server"));
  handle("open-client", () => service.openApp("client"));
  handle("client-download", () => shell.openExternal(CLIENT_DOWNLOAD_URL));
  handle("update-status", () => updater.getStatus());
  handle("update-check", () => updater.check());
  handle("update-download", () => updater.download());
  handle("update-auto", (enabled) => updater.setAutoUpdate(enabled === true));
  handle("update-install", () => {
    if (!updater.installNow()) return updater.getStatus();
    // The new bundle now sits at the old path, so relaunching starts the new version.
    app.relaunch();
    app.exit(0);
    return updater.getStatus();
  });
  handle("update-release-page", () => {
    const url = updater.releasePage();
    return url ? shell.openExternal(url) : undefined;
  });
}

function createAppUpdater() {
  // A separate in-memory session: the default session blocks all network requests for the renderer.
  const updateSession = session.fromPartition("softconnect-updates");
  return createUpdater({
    currentVersion: app.getVersion(),
    publicKey: UPDATE_PUBLIC_KEY,
    fetch: (url, init) => updateSession.fetch(url, init),
    tools: macTools(run),
    tempDir: app.getPath("temp"),
    packaged: app.isPackaged,
    execPath: process.execPath,
    preferences: filePreferences(join(app.getPath("userData"), "updates.json")),
    onStatus: (status) => sendToRenderer({ type: "update", status }),
  });
}

function buildMenu() {
  const navigate = (view) => () => sendToRenderer({ type: "navigate", view });
  return Menu.buildFromTemplate([
    { label: "SoftConnect", submenu: [
      { role: "about" },
      { label: "Check for Updates…", click: () => { updater?.check(); sendToRenderer({ type: "navigate", view: "settings" }); } },
      { type: "separator" },
      { label: "Settings…", accelerator: "CmdOrCtrl+,", click: navigate("settings") },
      { type: "separator" },
      { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ] },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "View", submenu: [
      { label: "Refresh Devices", accelerator: "CmdOrCtrl+R", click: () => sendToRenderer({ type: "refresh" }) },
      { label: "Find Device", accelerator: "CmdOrCtrl+F", click: () => sendToRenderer({ type: "find" }) },
      { type: "separator" },
      { label: "Overview", accelerator: "CmdOrCtrl+1", click: navigate("overview") },
      { label: "Devices", accelerator: "CmdOrCtrl+2", click: navigate("devices") },
      { label: "Connections", accelerator: "CmdOrCtrl+3", click: navigate("connections") },
      { label: "Activity", accelerator: "CmdOrCtrl+4", click: navigate("activity") },
    ] },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "close" }] },
  ]);
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
    minWidth: Math.min(760, width),
    minHeight: Math.min(560, height),
    show: false,
    backgroundColor: BACKGROUND,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
      spellcheck: false,
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
  updater = createAppUpdater();
  registerApi();
  Menu.setApplicationMenu(buildMenu());
  updater.start().catch((error) => console.error("SoftConnect could not start its updater:", error));
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
// A downloaded update replaces the app as it quits, the same moment Sparkle and Squirrel install.
app.on("will-quit", () => { updater?.installOnQuit(); });
