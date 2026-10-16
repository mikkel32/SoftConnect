import { memo } from "react";
import { DeviceRow } from "../components/DeviceRow.jsx";
import { Icon } from "../components/Icon.jsx";
import { EmptyState, PanelHeading, Status, TaskButton } from "../components/ui.jsx";

const READY_LIMIT = 5;

function Stat({ label, value, icon, accent = false }) {
  return (
    <div className={`stat${accent ? " accent" : ""}`}>
      <span className="stat-label"><Icon name={icon} size={14}/>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function HealthRow({ icon, title, detail, kind, label }) {
  return (
    <div className="health-row">
      <span className="row-icon"><Icon name={icon} size={17}/></span>
      <div><strong>{title}</strong><small title={detail}>{detail}</small></div>
      <Status kind={kind}>{label}</Status>
    </div>
  );
}

export const Overview = memo(function Overview({
  mode, hasBridge, groups, serverCount, nativeStatus, clientReason, pending, canCommand,
  onCommand, onInspect, onNavigate, onAddServer, onOpenClient, onGetClient,
}) {
  const isPreview = mode === "preview";
  const isLive = mode === "live";
  const checking = mode === "checking";
  const ready = groups.available.slice(0, READY_LIMIT);
  const clientInstalled = Boolean(nativeStatus.paths?.client);
  const subtitle = isPreview
    ? "Explore devices and connections with sample data. No USB session is changed."
    : isLive ? "Bring shared USB devices to this Mac, and release them when you're done."
    : checking ? "Looking for the native client and shared devices on this Mac."
    : "Start the official VirtualHere client to discover USB devices across your servers.";

  return (
    <>
      <header className="page-header overview-header">
        <div className="page-title">
          <span className="eyebrow">Control center</span>
          <h1>{isPreview ? <>USB sharing, <em>made simple.</em></> : isLive ? <>Your USB workspace, <em>connected.</em></> : <>Your USB workspace, <em>within reach.</em></>}</h1>
          <p>{subtitle}</p>
          <div className="quick-actions">
            {isPreview || isLive || checking
              ? <button className="button primary" disabled={checking} onClick={() => onNavigate("devices")}>Browse devices<Icon name="arrow" size={15}/></button>
              : clientInstalled
                ? <TaskButton className="button primary" busy={Boolean(pending["task:client"])} busyLabel="Opening client…" onClick={onOpenClient}>Open VirtualHere client<Icon name="external" size={15}/></TaskButton>
                : <button className="button primary" onClick={onGetClient} disabled={!hasBridge} title={hasBridge ? undefined : "Available in the macOS app"}>Get official client<Icon name="external" size={15}/></button>}
            <button className="button quiet" disabled={!canCommand} title={canCommand ? undefined : "Start the native client to add a server"} onClick={onAddServer}>
              <Icon name="plus" size={15}/>Add server
            </button>
          </div>
        </div>
        <div className="stat-row" aria-label="Workspace summary">
          <Stat label="Connected here" value={groups.connected.length} icon="link" accent/>
          <Stat label="Available" value={groups.available.length} icon="usb"/>
          <Stat label={serverCount === 1 ? "Server" : "Servers"} value={serverCount} icon="server"/>
        </div>
      </header>

      <div className="overview-grid">
        <div className="overview-main">
          <section className="panel">
            <PanelHeading eyebrow="This Mac" title="Connected devices"><span className="count-box">{groups.connected.length}</span></PanelHeading>
            {groups.connected.length
              ? <div className="row-list">{groups.connected.map((device) => (
                  <DeviceRow key={device.address} device={device} subtitle={device.serverName} pendingAction={pending[device.address]}
                    canCommand={canCommand} showStatus={false} onSelect={onInspect} onCommand={onCommand}/>
                ))}</div>
              : <EmptyState compact icon="link" title="Nothing connected yet" description={canCommand ? "Connect a device below and it will show up here." : "Connected devices appear here once the client is running."}/>}
          </section>

          <section className="panel">
            <PanelHeading eyebrow="Device radar" title="Ready to connect">
              <button className="link-button" onClick={() => onNavigate("devices")}>
                {groups.available.length > READY_LIMIT ? `View all ${groups.available.length}` : "View all"}<Icon name="arrow" size={14}/>
              </button>
            </PanelHeading>
            {ready.length
              ? <div className="row-list">{ready.map((device) => (
                  <DeviceRow key={device.address} device={device} subtitle={device.serverName} pendingAction={pending[device.address]}
                    canCommand={canCommand} showStatus={false} onSelect={onInspect} onCommand={onCommand}/>
                ))}</div>
              : <EmptyState compact icon="usb" title="No available devices"
                  description={isPreview ? "Every sample device is busy." : isLive ? "Every shared device is in use. Check Connections to see who has them." : "Start the native client to discover devices."}/>}
          </section>
        </div>

        <section className="panel health-panel">
          <PanelHeading eyebrow="System status" title="Workspace health"/>
          <HealthRow icon="terminal" title="VirtualHere client"
            detail={isPreview ? "Preview simulation" : isLive ? "Responding to the local API" : checking ? "Checking the local API" : clientReason || "Not responding"}
            kind={isPreview ? "preview" : isLive ? "connected" : checking ? "pending" : "offline"}
            label={isPreview ? "Preview" : isLive ? "Ready" : checking ? "Checking" : "Offline"}/>
          <HealthRow icon="server" title="VirtualHere server"
            detail={isPreview ? "Preview does not start a server" : checking ? "Checking this Mac" : nativeStatus.server?.installed ? "Installed on this Mac" : "Not installed on this Mac (optional)"}
            kind={isPreview ? "preview" : checking ? "pending" : nativeStatus.server?.running ? "connected" : "offline"}
            label={isPreview ? "Preview" : checking ? "Checking" : nativeStatus.server?.running ? "Running" : nativeStatus.server?.installed ? "Stopped" : "Not installed"}/>
          <HealthRow icon="link" title="In use elsewhere"
            detail={groups.remote.length ? groups.remote.map((device) => device.name).join(", ") : "No devices are held by other clients"}
            kind={groups.remote.length ? "occupied" : "offline"} label={String(groups.remote.length)}/>
          <div className="panel-note"><Icon name="shield" size={15}/><span>USB transport and drivers stay in the signed VirtualHere applications.</span></div>
        </section>
      </div>
    </>
  );
});
