import { memo } from "react";
import { deviceIcon, deviceState } from "../workspace/model.js";
import { Icon } from "./Icon.jsx";
import { Spinner, Status } from "./ui.jsx";

export function DeviceAction({ device, pendingAction, canCommand, onCommand, large = false, quietPending = false }) {
  const size = large ? "" : " small";
  if (pendingAction === "use" || pendingAction === "stop") {
    const label = pendingAction === "use" ? "Connecting…" : "Releasing…";
    // When the row already shows the pending status, the button keeps its place with just a spinner.
    return (
      <button className={`button quiet is-pending${size}`} disabled aria-busy="true" aria-label={label}>
        <Spinner/>{!quietPending && label}
      </button>
    );
  }
  const busy = Boolean(pendingAction);
  if (device.localUse) {
    return (
      <button className={`button quiet${size}`} disabled={!canCommand || busy} onClick={() => onCommand("stop", device.address)}>
        {large && <Icon name="close" size={15}/>}Release{large ? " device" : ""}
      </button>
    );
  }
  if (device.inUse) {
    return large ? <button className="button quiet" disabled>In use elsewhere</button> : <span className="action-spacer" aria-hidden="true"/>;
  }
  return (
    <button className={`button primary${size}`} disabled={!canCommand || busy} onClick={() => onCommand("use", device.address)}>
      Connect{large ? " to this Mac" : ""}<Icon name="arrow" size={large ? 15 : 13}/>
    </button>
  );
}

export const DeviceRow = memo(function DeviceRow({ device, subtitle, pendingAction, selected = false, canCommand, showStatus = true, onSelect, onCommand }) {
  const state = deviceState(device, pendingAction);
  return (
    <div className={`device-row${selected ? " selected" : ""}`}>
      <button className="device-row-main" data-device={device.address} aria-current={selected || undefined}
        aria-label={[device.name, subtitle ?? device.address, device.autoUse && "auto use on", state.label].filter(Boolean).join(", ")}
        onClick={() => onSelect(device.address)}>
        <span className={`device-icon tone-${state.key}`}><Icon name={deviceIcon(device.name)} size={18}/></span>
        <span className="device-row-text">
          <strong>{device.name}</strong>
          <small>{subtitle ?? device.address}</small>
        </span>
        {device.autoUse && <span className="tag" title="Auto use is on">Auto</span>}
        {showStatus && <Status kind={state.key}>{state.label}</Status>}
      </button>
      <DeviceAction device={device} pendingAction={pendingAction} canCommand={canCommand} onCommand={onCommand} quietPending={showStatus}/>
    </div>
  );
});
