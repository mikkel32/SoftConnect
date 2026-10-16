import { memo } from "react";
import logo from "../assets/softconnect-icon.svg";
import { Icon } from "../components/Icon.jsx";
import { PanelHeading, Status, TaskButton } from "../components/ui.jsx";

const SHORTCUTS = [
  [["⌘", "K"], "Search devices (also ⌘F)"],
  [["⌘", "R"], "Refresh the device list"],
  [["⌘", "1–4"], "Switch between views"],
  [["⌘", ","], "Open settings"],
  [["↑", "↓"], "Move through the device list"],
  [["Esc"], "Close a dialog or clear the search"],
];

export const Settings = memo(function Settings({ mode, preview, autoRefresh, nativeStatus, pending, version, hasBridge, onAutoRefresh, onPreview, onOpenClient, onGetClient, onOpenServer, onDiagnostics, onRefresh }) {
  const live = mode === "live";
  const checking = mode === "checking";
  const clientPath = nativeStatus.paths?.client;
  // Show the app bundle people recognize, not the executable inside it.
  const clientApp = clientPath?.replace(/\/Contents\/MacOS\/[^/]+$/, "");
  const serverPath = nativeStatus.paths?.serverApp;
  return (
    <>
      <header className="page-header">
        <div className="page-title">
          <span className="eyebrow">Preferences</span>
          <h1>Settings</h1>
          <p>Control this workspace and inspect its native integration.</p>
        </div>
      </header>
      <div className="two-column">
        <section className="panel">
          <PanelHeading eyebrow="Workspace" title="Behavior"/>
          <label className="setting-row">
            <span className="row-icon"><Icon name="refresh" size={17}/></span>
            <span className="setting-copy"><strong>Automatic refresh</strong><small>Every 8 seconds while the client is live and this window is focused, every 30 seconds otherwise. Paused while hidden. When off, refresh with ⌘R.</small></span>
            <input type="checkbox" role="switch" checked={autoRefresh} onChange={(event) => onAutoRefresh(event.target.checked)}/>
          </label>
          <label className="setting-row">
            <span className="row-icon"><Icon name="spark" size={17}/></span>
            <span className="setting-copy"><strong>Preview workspace</strong><small>Try the interface with sample devices. Changes never reach the native client.</small></span>
            <input type="checkbox" role="switch" checked={preview} onChange={(event) => onPreview(event.target.checked)}/>
          </label>
          <div className="panel-note"><Icon name="info" size={15}/><span>Preview is labeled everywhere in the app. It does not simulate a USB transport.</span></div>
        </section>

        <section className="panel">
          <PanelHeading eyebrow="Native integration" title="Local components"/>
          <div className="setting-row">
            <span className="row-icon"><Icon name="terminal" size={17}/></span>
            <span className="setting-copy"><strong>VirtualHere client</strong><small title={clientPath || undefined}>{clientApp || (checking ? "Checking supported locations" : "Not found in /Applications or ~/Applications")}</small></span>
            <Status kind={live ? "connected" : checking ? "pending" : "offline"}>{live ? "Ready" : checking ? "Checking" : clientPath ? "Not running" : "Not installed"}</Status>
          </div>
          <div className="setting-row">
            <span className="row-icon"><Icon name="server" size={17}/></span>
            <span className="setting-copy"><strong>VirtualHere server</strong><small>{serverPath || (checking ? "Checking supported locations" : "Optional. Needed only if this Mac shares its own USB devices.")}</small></span>
            <Status kind={checking ? "pending" : nativeStatus.server?.running ? "connected" : "offline"}>{checking ? "Checking" : nativeStatus.server?.running ? "Running" : serverPath ? "Stopped" : "Not installed"}</Status>
          </div>
          <div className="settings-actions">
            {clientPath
              ? <TaskButton busy={Boolean(pending["task:client"])} busyLabel="Opening…" icon="external" onClick={onOpenClient}>Open client</TaskButton>
              : <button className="button quiet" onClick={onGetClient} disabled={!hasBridge || checking}><Icon name="external" size={15}/>Get official client</button>}
            <TaskButton busy={Boolean(pending["task:diagnostics"])} busyLabel="Reading…" icon="info" onClick={onDiagnostics} disabled={!live}>Client diagnostics</TaskButton>
            <TaskButton busy={Boolean(pending["task:server"])} busyLabel="Opening…" icon="external" onClick={onOpenServer} disabled={!nativeStatus.server?.installed}>Open server</TaskButton>
            <button className="button quiet" onClick={onRefresh} disabled={!hasBridge}><Icon name="refresh" size={15}/>Refresh status</button>
          </div>
        </section>
      </div>

      <section className="panel shortcuts-panel">
        <PanelHeading eyebrow="Keyboard" title="Shortcuts"/>
        <dl className="shortcut-list">
          {SHORTCUTS.map(([keys, label]) => (
            <div key={label}><dt>{keys.map((key) => <kbd key={key}>{key}</kbd>)}</dt><dd>{label}</dd></div>
          ))}
        </dl>
      </section>

      <section className="panel about-panel">
        <img src={logo} alt=""/>
        <div>
          <strong>SoftConnect</strong>
          <p>An independent desktop interface for the documented VirtualHere client API. The installed native software handles USB transport, drivers, and licensing.</p>
        </div>
        <span>v{version}</span>
      </section>
    </>
  );
});
