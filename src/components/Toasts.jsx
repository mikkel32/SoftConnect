import { dismissToast, useToasts } from "../workspace/toasts.js";
import { Icon } from "./Icon.jsx";

const ICONS = { info: "info", success: "checkCircle", error: "warning" };

export function Toasts() {
  const toasts = useToasts();
  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"}>
          <Icon name={ICONS[toast.kind] || "info"} size={16}/>
          <span>{toast.text}</span>
          <button onClick={() => dismissToast(toast.id)} aria-label="Dismiss message"><Icon name="close" size={13}/></button>
        </div>
      ))}
    </div>
  );
}
