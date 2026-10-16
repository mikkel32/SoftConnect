import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef } from "react";
import { DeviceAction, DeviceRow } from "../components/DeviceRow.jsx";
import { Icon } from "../components/Icon.jsx";
import { EmptyState, Status, TaskButton } from "../components/ui.jsx";
import { countByFilter, deviceIcon, deviceState, FILTERS, filterServers, ownerLabel } from "../workspace/model.js";

function ServerGroup({ server, collapsed, selection, pending, canCommand, onToggle, onSelect, onSelectDevice, onCommand }) {
  const selected = selection?.type === "server" && selection.id === server.address;
  return (
    <div className="server-group">
      <div className={`server-heading${selected ? " selected" : ""}`}>
        <button className="server-select" aria-current={selected || undefined} onClick={() => onSelect({ type: "server", id: server.address })}>
          <span className="server-symbol"><Icon name="server" size={16}/></span>
          <span className="server-text"><strong>{server.name}</strong><small>{server.address}</small></span>
          <b>{server.devices.length}</b>
        </button>
        <button className="icon-button ghost" aria-expanded={!collapsed} aria-label={`${collapsed ? "Expand" : "Collapse"} ${server.name}`} onClick={() => onToggle(server.address)}>
          <Icon name="down" size={16} className={collapsed ? "folded" : undefined}/>
        </button>
      </div>
      {!collapsed && (
        <div className="row-list server-devices">
          {server.devices.length
            ? server.devices.map((device) => (
                <DeviceRow key={device.address} device={device} pendingAction={pending[device.address]} canCommand={canCommand}
                  selected={selection?.type === "device" && selection.id === device.address}
                  onSelect={onSelectDevice} onCommand={onCommand}/>
              ))
            : <p className="server-empty">No matching devices on this server.</p>}
        </div>
      )}
    </div>
  );
}

function Inspector({ device, server, pending, canCommand, onCommand, onRename, onInfo }) {
  if (device) {
    const pendingAction = pending[device.address];
    const state = deviceState(device, pendingAction);
    const busy = Boolean(pendingAction);
    return (
      <>
        <div className={`inspector-icon tone-${state.key}`}><Icon name={deviceIcon(device.name)} size={28}/></div>
        <h2>{device.name}</h2>
        <p className="inspector-subtitle">Shared from {device.serverName}</p>
        <Status kind={state.key}>{state.label}</Status>
        <dl className="details-list">
          <div><dt>Address</dt><dd>{device.address}</dd></div>
          <div><dt>Server</dt><dd>{device.serverName}</dd></div>
          <div><dt>Auto use</dt><dd>{device.autoUse ? "On" : "Off"}</dd></div>
          {device.inUse && !device.localUse && <div><dt>Held by</dt><dd>{ownerLabel(device).replace(/^Used by /, "")}</dd></div>}
          {device.detail && !device.inUse && <div><dt>Client note</dt><dd>{device.detail}</dd></div>}
        </dl>
        <div className="inspector-actions">
          <DeviceAction large device={device} pendingAction={pendingAction} canCommand={canCommand} onCommand={onCommand}/>
          <div className="button-pair">
            <button className="button quiet" disabled={!canCommand || busy} onClick={() => onInfo("device-info", device.address, `${device.name} properties`)}><Icon name="info" size={15}/>Properties</button>
            <button className="button quiet" disabled={!canCommand || busy} onClick={() => onRename(device)}><Icon name="pencil" size={15}/>Rename</button>
          </div>
          <label className="switch-row">
            <span><strong>Auto use</strong><small>Connect this device automatically when it appears.</small></span>
            <input type="checkbox" role="switch" checked={Boolean(device.autoUse)} disabled={!canCommand || busy} onChange={() => onCommand("auto-device", device.address)}/>
          </label>
        </div>
      </>
    );
  }
  if (server) {
    return (
      <>
        <div className="inspector-icon"><Icon name="server" size={28}/></div>
        <h2>{server.name}</h2>
        <p className="inspector-subtitle">USB server</p>
        <dl className="details-list">
          <div><dt>Address</dt><dd>{server.address}</dd></div>
          <div><dt>Shared devices</dt><dd>{server.devices.length}</dd></div>
          <div><dt>Connected here</dt><dd>{server.devices.filter((device) => device.localUse).length}</dd></div>
        </dl>
        <div className="inspector-actions">
          <TaskButton busy={Boolean(pending[`server:${server.name}`])} busyLabel="Reading…" icon="info" disabled={!canCommand}
            onClick={() => onInfo("server-info", server.name, `${server.name} properties`)}>Server properties</TaskButton>
        </div>
      </>
    );
  }
  return <EmptyState icon="usb" title="Select a device" description="Choose a device to see its details. Use ↑ and ↓ to move through the list."/>;
}

export const Devices = memo(function Devices({
  servers, devices, mode, canCommand, pending, selection, search, filter, collapsed, focusSearch,
  onSearchFocused, onToggleServer, onSearch, onFilter, onSelect, onCommand, onAddServer, onRename, onInfo,
}) {
  const searchRef = useRef(null);
  const selectDevice = useCallback((address) => onSelect({ type: "device", id: address }), [onSelect]);
  const query = useDeferredValue(search);
  const visible = useMemo(() => filterServers(servers, query, filter), [servers, query, filter]);
  const counts = useMemo(() => countByFilter(devices), [devices]);
  const visibleDeviceCount = visible.reduce((count, server) => count + server.devices.length, 0);
  const device = selection?.type === "device" ? devices.find((candidate) => candidate.address === selection.id) : null;
  const server = selection?.type === "server" ? servers.find((candidate) => candidate.address === selection.id) : null;

  // One-shot: the request is cleared once handled, so later visits to Devices keep focus where it was.
  useEffect(() => {
    if (!focusSearch) return;
    searchRef.current?.focus();
    searchRef.current?.select();
    onSearchFocused();
  }, [focusSearch, onSearchFocused]);

  // Arrow keys move the selection between visible device rows.
  function onListKeyDown(event) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = [...event.currentTarget.querySelectorAll("[data-device]")];
    const index = rows.indexOf(document.activeElement);
    if (index < 0 || !rows.length) return;
    event.preventDefault();
    const next = rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
    next.focus();
    onSelect({ type: "device", id: next.dataset.device });
  }

  return (
    <>
      <header className="page-header">
        <div className="page-title">
          <span className="eyebrow">Discover</span>
          <h1>Devices</h1>
          <p>Find a shared device, check who has it, and connect it to this Mac.</p>
        </div>
        <button className="button quiet" disabled={!canCommand} title={canCommand ? undefined : "Start the native client to add a server"} onClick={onAddServer}>
          <Icon name="plus" size={15}/>Add server
        </button>
      </header>

      <div className="toolbar">
        <label className="search-box">
          <Icon name="search" size={16}/>
          <input ref={searchRef} type="search" value={search} placeholder="Search devices or servers" aria-label="Search devices or servers"
            spellCheck={false} onChange={(event) => onSearch(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape" && search) { event.preventDefault(); onSearch(""); } }}/>
          <kbd>⌘K</kbd>
        </label>
        <div className="segmented" role="group" aria-label="Filter devices">
          {FILTERS.map((item) => (
            <button key={item.id} className={filter === item.id ? "active" : undefined} aria-pressed={filter === item.id} onClick={() => onFilter(item.id)}>
              {item.label}<span>{counts[item.id]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="device-layout">
        <section className="panel device-browser" aria-label="Shared USB devices" onKeyDown={onListKeyDown}>
          <div className="list-heading">
            <span>{visible.length} {visible.length === 1 ? "server" : "servers"} · {visibleDeviceCount} {visibleDeviceCount === 1 ? "device" : "devices"}</span>
            {(search || filter !== "all") && <button className="link-button" onClick={() => { onSearch(""); onFilter("all"); }}>Clear filters</button>}
          </div>
          {visible.length
            ? visible.map((item) => (
                <ServerGroup key={item.address} server={item} collapsed={Boolean(collapsed[item.address]) && !query} selection={selection}
                  pending={pending} canCommand={canCommand} onToggle={onToggleServer} onSelect={onSelect} onSelectDevice={selectDevice} onCommand={onCommand}/>
              ))
            : <EmptyState icon="search" title={search || filter !== "all" ? "No matching devices" : "No servers yet"}
                description={search || filter !== "all" ? "Try another search or filter." : mode === "preview" ? "No preview devices available." : canCommand ? "Add a server, or turn on Auto-Find in the VirtualHere client." : "Start the native client to discover devices."}/>}
        </section>
        <aside className="panel device-inspector" aria-label="Device details">
          <Inspector device={device} server={server} pending={pending} canCommand={canCommand} onCommand={onCommand} onRename={onRename} onInfo={onInfo}/>
        </aside>
      </div>
    </>
  );
});
