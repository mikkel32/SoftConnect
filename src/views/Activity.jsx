import { memo } from "react";
import { Icon } from "../components/Icon.jsx";
import { EmptyState, TaskButton } from "../components/ui.jsx";

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const KIND = {
  error: { icon: "warning", label: "Failed" },
  preview: { icon: "spark", label: "Preview" },
  success: { icon: "check", label: "Confirmed" },
  live: { icon: "bolt", label: "Requested" },
};

export const Activity = memo(function Activity({ activity, mode, hasLog, logBusy, onReadLog, onClear }) {
  return (
    <>
      <header className="page-header">
        <div className="page-title">
          <span className="eyebrow">Local timeline</span>
          <h1>Activity</h1>
          <p>Commands and results from this window since it opened. This is not a server audit log.</p>
        </div>
        <div className="header-actions">
          <button className="button quiet" onClick={onClear} disabled={!activity.length}><Icon name="trash" size={15}/>Clear</button>
          <TaskButton busy={logBusy} busyLabel="Reading log…" icon="terminal" onClick={onReadLog} disabled={mode === "preview" || !hasLog}>Server log</TaskButton>
        </div>
      </header>
      <section className="panel">
        <div className="list-heading"><span>Recent activity</span><span>{activity.length} {activity.length === 1 ? "event" : "events"}</span></div>
        {activity.length
          ? <ol className="timeline">{activity.map((event) => {
              const kind = KIND[event.kind] || KIND.live;
              return (
                <li key={event.id}>
                  <span className={`timeline-icon ${event.kind}`}><Icon name={kind.icon} size={14}/></span>
                  <div>
                    <strong>{event.title}</strong>
                    <p>{event.detail}</p>
                    <small>{timeFormat.format(event.time)} · {kind.label}</small>
                  </div>
                </li>
              );
            })}</ol>
          : <EmptyState icon="pulse" title="No actions yet" description="Connect, release, or configure a device and the result shows up here."/>}
      </section>
    </>
  );
});
