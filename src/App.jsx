import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { version as appVersion } from "../package.json";
import { ConnectionBanner, Sidebar, StatusBar, Topbar } from "./components/chrome.jsx";
import { FormDialog, InfoDialog } from "./components/Dialog.jsx";
import { Toasts } from "./components/Toasts.jsx";
import { Activity } from "./views/Activity.jsx";
import { Connections } from "./views/Connections.jsx";
import { Devices } from "./views/Devices.jsx";
import { Overview } from "./views/Overview.jsx";
import { Settings } from "./views/Settings.jsx";
import { fieldError, SETTINGS_VIEW, VIEW_IDS, VIEWS } from "./workspace/model.js";
import { notify } from "./workspace/toasts.js";
import { useUpdates } from "./workspace/useUpdates.js";
import { useWorkspace } from "./workspace/useWorkspace.js";

const TITLES = Object.fromEntries([...VIEWS, SETTINGS_VIEW].map((item) => [item.id, item.label]));
// On macOS, Control+K/F are text-editing keys; only Command is the app modifier.
const IS_MAC = /Mac/i.test(navigator.platform || navigator.userAgent);
const validateAddress = (value) => fieldError(value, { allowSpaces: false });

export function App() {
  const { state, actions } = useWorkspace();
  const updates = useUpdates();
  const [view, setView] = useState("overview");
  const [selection, setSelection] = useState(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [dialog, setDialog] = useState(null);
  const [searchFocusPending, setSearchFocusPending] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const mainRef = useRef(null);
  const dialogOpen = useRef(false);
  useLayoutEffect(() => { dialogOpen.current = Boolean(dialog); });

  const { devices, servers, mode, pending, canCommand } = state;

  const navigate = useCallback((target) => {
    if (!VIEW_IDS.includes(target)) return;
    setView(target);
  }, []);

  const focusSearch = useCallback(() => {
    setView("devices");
    setSearchFocusPending(true);
  }, []);
  const searchFocused = useCallback(() => setSearchFocusPending(false), []);
  const toggleServer = useCallback((address) => setCollapsed((current) => ({ ...current, [address]: !current[address] })), []);

  const inspect = useCallback((address) => {
    setSelection({ type: "device", id: address });
    setView("devices");
  }, []);

  // Each view starts at the top instead of inheriting the previous view's scroll position.
  useEffect(() => { mainRef.current?.scrollTo(0, 0); }, [view]);

  // Keep the selection valid as the inventory changes, and pick a device when Devices opens empty-handed.
  useEffect(() => {
    const exists = selection && (selection.type === "device"
      ? devices.some((device) => device.address === selection.id)
      : servers.some((server) => server.address === selection.id));
    if (selection && !exists) setSelection(null);
    else if (!selection && view === "devices" && devices.length) setSelection({ type: "device", id: devices[0].address });
  }, [devices, servers, selection, view]);

  useEffect(() => {
    function onKeyDown(event) {
      const modifier = IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey;
      if (event.defaultPrevented || !modifier || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      const isShortcut = ["k", "f", "r", ","].includes(key) || /^[1-4]$/.test(key);
      if (!isShortcut) return;
      // Swallow app shortcuts while a dialog is open so the menu does not act behind it.
      event.preventDefault();
      if (dialogOpen.current || event.repeat) return;
      if (key === "k" || key === "f") focusSearch();
      else if (key === "r") actions.refresh();
      else if (key === ",") navigate("settings");
      else navigate(VIEWS[Number(key) - 1].id);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions, focusSearch, navigate]);

  // Native menu items (View, Settings…) arrive from the main process.
  useEffect(() => {
    const bridge = window.softconnect;
    if (!bridge?.onEvent) return undefined;
    return bridge.onEvent((event) => {
      if (dialogOpen.current) return;
      if (event?.type === "navigate") navigate(event.view);
      else if (event?.type === "refresh") actions.refresh();
      else if (event?.type === "find") focusSearch();
    });
  }, [actions, focusSearch, navigate]);

  // A result that arrives while a form is open waits until the form closes, so typed text is never lost.
  const showUpdates = useCallback(() => navigate("settings"), [navigate]);
  const closeDialog = useCallback(() => setDialog((current) => current?.queued || null), []);
  const openAddServer = useCallback(() => setDialog({ kind: "add-server" }), []);
  const openRename = useCallback((device) => setDialog({ kind: "rename", target: device.address, value: device.name }), []);
  const showInfo = useCallback(async (title, load) => {
    const text = await load();
    if (text == null) return;
    const info = { kind: "info", title, text };
    setDialog((current) => (current && current.kind !== "info" ? { ...current, queued: info } : info));
  }, []);
  const commandInfo = useCallback((action, target, title) => showInfo(title, () => actions.command(action, target)), [actions, showInfo]);
  const togglePreview = useCallback((enabled) => {
    actions.setPreview(enabled);
    setSelection(null);
    notify(enabled ? "Preview data is active" : "Back to the native client", "info");
  }, [actions]);

  return (
    <div className="app-shell">
      <Sidebar view={view} mode={mode} connectedCount={state.groups.connected.length}
        version={state.nativeStatus.appVersion || appVersion} onNavigate={navigate}/>
      <div className="main-shell">
        <Topbar title={TITLES[view]} mode={mode} syncing={state.syncing} update={updates.status} onRefresh={actions.refresh}
          onInstallUpdate={updates.actions.install} onShowUpdates={showUpdates}/>
        <main className="main-content" id="main-content" ref={mainRef}>
          <div className="page">
            <ConnectionBanner mode={mode} reason={state.clientReason} clientInstalled={Boolean(state.nativeStatus.paths?.client)}
              opening={Boolean(pending["task:client"])} onOpenClient={actions.openClient} onGetClient={actions.openClientDownload}
              onPreview={() => togglePreview(true)}/>
            {view === "overview" && (
              <Overview mode={mode} hasBridge={state.hasBridge} groups={state.groups} serverCount={servers.length} nativeStatus={state.nativeStatus}
                clientReason={state.clientReason} pending={pending} canCommand={canCommand} onCommand={actions.command}
                onInspect={inspect} onNavigate={navigate} onAddServer={openAddServer} onOpenClient={actions.openClient}
                onGetClient={actions.openClientDownload}/>
            )}
            {view === "devices" && (
              <Devices servers={servers} devices={devices} mode={mode} canCommand={canCommand} pending={pending}
                selection={selection} search={search} filter={filter} collapsed={collapsed} focusSearch={searchFocusPending}
                onSearchFocused={searchFocused} onToggleServer={toggleServer}
                onSearch={setSearch} onFilter={setFilter} onSelect={setSelection} onCommand={actions.command}
                onAddServer={openAddServer} onRename={openRename} onInfo={commandInfo}/>
            )}
            {view === "connections" && (
              <Connections groups={state.groups} mode={mode} pending={pending} canCommand={canCommand}
                onCommand={actions.command} onInspect={inspect} onNavigate={navigate}/>
            )}
            {view === "activity" && (
              <Activity activity={state.activity} mode={mode} hasLog={state.hasBridge} logBusy={Boolean(pending["task:log"])}
                onReadLog={() => showInfo("VirtualHere server log", actions.readServerLog)} onClear={actions.clearActivity}/>
            )}
            {view === "settings" && (
              <Settings mode={mode} preview={state.preview} autoRefresh={state.autoRefresh} nativeStatus={state.nativeStatus}
                pending={pending} version={state.nativeStatus.appVersion || appVersion} hasBridge={state.hasBridge}
                update={updates.status} updateActions={updates.actions}
                onAutoRefresh={actions.setAutoRefresh} onPreview={togglePreview} onOpenClient={actions.openClient}
                onGetClient={actions.openClientDownload} onOpenServer={actions.openServer}
                onDiagnostics={() => showInfo("Native client diagnostics", actions.readDiagnostics)} onRefresh={actions.refresh}/>
            )}
          </div>
        </main>
        <StatusBar mode={mode} lastSync={state.lastSync} deviceCount={devices.length} serverCount={servers.length}/>
      </div>
      <Toasts/>
      {dialog?.kind === "info" && <InfoDialog title={dialog.title} text={dialog.text} onClose={closeDialog}/>}
      {dialog?.kind === "add-server" && (
        <FormDialog title="Add a USB server" label="Server address" placeholder="server.local:7575" submitLabel="Add server"
          description="Add a server to the client's manual hub list. Port 7575 is used when you leave it out."
          note={mode === "preview" ? "This updates preview data only." : "Sent to the VirtualHere client as MANUAL HUB ADD."}
          validate={validateAddress} onSubmit={(value) => actions.command("manual-add", value)} onClose={closeDialog}/>
      )}
      {dialog?.kind === "rename" && (
        <FormDialog title="Rename device" label="Device name" initialValue={dialog.value} placeholder="Device name" submitLabel="Save name"
          description="Choose a display name. The VirtualHere client stores it as a nickname for this device."
          note={mode === "preview" ? "This updates preview data only." : "Sent to the VirtualHere client when you save."}
          validate={fieldError} onSubmit={(value) => actions.command("device-rename", dialog.target, value)} onClose={closeDialog}/>
      )}
    </div>
  );
}
