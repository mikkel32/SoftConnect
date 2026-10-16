import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./Icon.jsx";

const FOCUSABLE = "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex='-1'])";

export function Dialog({ title, onClose, footer, children, wide = false }) {
  const ref = useRef(null);
  const titleId = useId();
  // The latest onClose is read through a ref so the focus effect runs once per dialog, not per render.
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    const node = ref.current;
    const previous = document.activeElement;
    const initial = node.querySelector("[data-autofocus]") || node;
    initial.focus();
    if (initial instanceof HTMLInputElement) initial.select();
    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...node.querySelectorAll(FOCUSABLE)];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCloseRef.current(); }}>
      <section ref={ref} tabIndex={-1} className={`dialog${wide ? " dialog-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="dialog-header">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button" onClick={() => onCloseRef.current()} aria-label="Close dialog"><Icon name="close" size={16}/></button>
        </header>
        <div className="dialog-content">{children}</div>
        <footer className="dialog-footer">{footer}</footer>
      </section>
    </div>
  );
}

export function InfoDialog({ title, text, onClose }) {
  return (
    <Dialog title={title} onClose={onClose} wide footer={<button className="button primary" data-autofocus onClick={onClose}>Done</button>}>
      <pre className="properties-text">{text}</pre>
    </Dialog>
  );
}

// Owns its own input state, so typing re-renders only this dialog.
export function FormDialog({ title, description, label, initialValue = "", placeholder, submitLabel, note, validate, onSubmit, onClose }) {
  const [value, setValue] = useState(initialValue);
  const formId = useId();
  const inputId = useId();
  const hintId = useId();
  const trimmed = value.trim();
  const error = validate?.(value) || null;
  const disabled = !trimmed || Boolean(error) || (Boolean(initialValue) && trimmed === initialValue.trim());

  function submit(event) {
    event.preventDefault();
    if (disabled) return;
    onSubmit(trimmed);
    onClose();
  }

  return (
    <Dialog title={title} onClose={onClose} footer={<>
      <button type="button" className="button quiet" onClick={onClose}>Cancel</button>
      <button type="submit" form={formId} className="button primary" disabled={disabled}>{submitLabel}</button>
    </>}>
      <form id={formId} onSubmit={submit} noValidate>
        {description && <p>{description}</p>}
        <label className="field-label" htmlFor={inputId}>{label}</label>
        <input id={inputId} className={`dialog-input${error ? " invalid" : ""}`} data-autofocus value={value}
          onChange={(event) => setValue(event.target.value)} placeholder={placeholder}
          spellCheck={false} autoComplete="off" autoCapitalize="off" aria-invalid={Boolean(error)} aria-describedby={hintId}/>
        <small id={hintId} className={error ? "field-error" : "field-note"}>{error || note}</small>
      </form>
    </Dialog>
  );
}
