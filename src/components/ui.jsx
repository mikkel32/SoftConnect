import { Icon } from "./Icon.jsx";

export function Status({ kind = "available", children }) {
  return <span className={`status status-${kind}`}><span className="status-led" aria-hidden="true"/>{children}</span>;
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true"/>;
}

export function EmptyState({ icon, title, description, action, compact = false }) {
  return (
    <div className={`empty-state${compact ? " compact" : ""}`}>
      <span className="empty-icon"><Icon name={icon} size={compact ? 20 : 26}/></span>
      <div>
        <h3>{title}</h3>
        {description && <p>{description}</p>}
        {action}
      </div>
    </div>
  );
}

export function PanelHeading({ eyebrow, title, children }) {
  return (
    <div className="panel-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}

// Busy-aware button: keeps its width stable and shows a spinner instead of freezing the whole window.
export function TaskButton({ busy, busyLabel, icon, children, className = "button quiet", disabled, ...props }) {
  return (
    <button className={className} disabled={disabled || busy} aria-busy={busy || undefined} {...props}>
      {busy ? <Spinner/> : icon && <Icon name={icon} size={16}/>}
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}
