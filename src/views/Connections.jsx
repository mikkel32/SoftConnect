import { memo } from "react";
import { DeviceRow } from "../components/DeviceRow.jsx";
import { Icon } from "../components/Icon.jsx";
import { EmptyState, PanelHeading } from "../components/ui.jsx";
import { ownerLabel } from "../workspace/model.js";

export const Connections = memo(function Connections({ groups, mode, pending, canCommand, onCommand, onInspect, onNavigate }) {
  return (
    <>
      <header className="page-header">
        <div className="page-title">
          <span className="eyebrow">Active sessions</span>
          <h1>Connections</h1>
          <p>What is attached to this Mac, and which devices other clients are using.</p>
        </div>
      </header>
      <div className="two-column">
        <section className="panel">
          <PanelHeading eyebrow="This Mac" title="Connected devices"><span className="count-box">{groups.connected.length}</span></PanelHeading>
          {groups.connected.length
            ? <div className="row-list">{groups.connected.map((device) => (
                <DeviceRow key={device.address} device={device} subtitle={`${device.serverName} · ${device.address}`} pendingAction={pending[device.address]}
                  canCommand={canCommand} showStatus={false} onSelect={onInspect} onCommand={onCommand}/>
              ))}</div>
            : <EmptyState icon="link" title="No active connections"
                description={mode === "preview" ? "Connect a sample device to see it here." : "Devices connected on this Mac appear here."}
                action={<button className="link-button" onClick={() => onNavigate("devices")}>Browse devices<Icon name="arrow" size={14}/></button>}/>}
        </section>
        <section className="panel">
          <PanelHeading eyebrow="Other clients" title="In use elsewhere"><span className="count-box amber">{groups.remote.length}</span></PanelHeading>
          {groups.remote.length
            ? <div className="row-list">{groups.remote.map((device) => (
                <DeviceRow key={device.address} device={device} subtitle={`${ownerLabel(device)} · ${device.serverName}`} pendingAction={pending[device.address]}
                  canCommand={canCommand} showStatus={false} onSelect={onInspect} onCommand={onCommand}/>
              ))}</div>
            : <EmptyState icon="check" title="Nothing busy elsewhere" description="Devices held by another client appear here when the native client reports them."/>}
        </section>
      </div>
      <p className="page-note"><Icon name="shield" size={15}/>Ownership comes from the native client. SoftConnect shows a device as connected only after the client confirms it.</p>
    </>
  );
});
