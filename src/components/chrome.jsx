import { memo } from "react";
import logo from "../assets/softconnect-icon.svg";
import { MODES, SETTINGS_VIEW, VIEWS } from "../workspace/model.js";
import { Icon } from "./Icon.jsx";
import { Spinner } from "./ui.jsx";

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function NavItem({ item, active, badge, onNavigate }) {
  return (
    <button className={`nav-item${active ? " active" : ""}`} aria-current={active ? "page" : undefined}
      onClick={() => onNavigate(item.id)} title={`${item.label}  ⌘${item.shortcut}`}>
      <Icon name={item.icon} size={18}/>
      <span>{item.label}</span>
      {badge ? <b>{badge}</b> : <kbd>⌘{item.shortcut}</kbd>}
    </button>
  );
}

export const Sidebar = memo(function Sidebar({ view, mode, connectedCount, version, onNavigate }) {
  const info = MODES[mode];
  return (
    <aside className="sidebar">
      <div className="brand">
        <img src={logo} alt=""/>
        <div><strong>SoftConnect</strong><span>USB workspace</span></div>
      </div>
      <nav className="nav" aria-label="Main navigation">
        <div className="nav-label">Workspace</div>
        {VIEWS.map((item) => (
          <NavItem key={item.id} item={item} active={view === item.id} onNavigate={onNavigate}
            badge={item.id === "connections" ? connectedCount : 0}/>
        ))}
        <div className="nav-label">Preferences</div>
        <NavItem item={SETTINGS_VIEW} active={view === SETTINGS_VIEW.id} onNavigate={onNavigate}/>
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-status">
          <span className={`dot tone-${info.tone}`}/>
          <div><strong>{info.title}</strong><small>{info.detail}</small></div>
        </div>
        <div className="sidebar-version">SoftConnect <span>v{version}</span></div>
      </div>
    </aside>
  );
});

export const Topbar = memo(function Topbar({ title, mode, syncing, onRefresh }) {
  const info = MODES[mode];
  const spinning = syncing || mode === "checking";
  return (
    <header className="topbar">
      <div className="breadcrumbs"><span>Workspace</span><Icon name="chevron" size={13}/><strong>{title}</strong></div>
      <div className="top-actions">
        <span className={`mode-chip tone-${info.tone}`}><span aria-hidden="true"/>{info.chip}</span>
        <button className="icon-button" onClick={onRefresh} disabled={syncing} title="Refresh  ⌘R" aria-label="Refresh device list">
          <Icon name="refresh" size={16} className={spinning ? "spinning" : undefined}/>
        </button>
      </div>
    </header>
  );
});

export const StatusBar = memo(function StatusBar({ mode, lastSync, deviceCount, serverCount }) {
  const info = MODES[mode];
  return (
    <footer className="statusbar">
      <span className="statusbar-mode"><span className={`dot small tone-${info.tone}`}/>{info.status}</span>
      <span>
        {mode === "preview" ? "Sample workspace" : `${deviceCount} ${deviceCount === 1 ? "device" : "devices"} on ${serverCount} ${serverCount === 1 ? "server" : "servers"}`}
        {mode !== "preview" && lastSync ? ` · Checked ${timeFormat.format(lastSync)}` : ""}
      </span>
    </footer>
  );
});

export function ConnectionBanner({ mode, reason, clientInstalled, opening, onOpenClient, onGetClient, onPreview }) {
  if (mode !== "offline" && mode !== "unavailable") return null;
  const bridgeMissing = mode === "unavailable";
  return (
    <div className="banner" role="status">
      <span className="banner-icon"><Icon name="warning" size={18}/></span>
      <div className="banner-text">
        <strong>{bridgeMissing ? "The desktop bridge is unavailable" : "The VirtualHere client is not responding"}</strong>
        <p>{bridgeMissing ? "Run SoftConnect as the macOS app to reach local USB devices." : reason || "Start the installed client, then refresh."}</p>
      </div>
      <div className="banner-actions">
        {!bridgeMissing && (clientInstalled
          ? <button className="button small primary" onClick={onOpenClient} disabled={opening}>{opening ? <><Spinner/>Opening…</> : <>Open client<Icon name="external" size={13}/></>}</button>
          : <button className="button small primary" onClick={onGetClient}>Get official client<Icon name="external" size={13}/></button>)}
        <button className="button small quiet" onClick={onPreview}>Explore preview</button>
      </div>
    </div>
  );
}
