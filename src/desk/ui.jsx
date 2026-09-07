import { useEffect } from "react";
import { fmtMoney } from "../lib/invoice.js";

/* Small shared pieces for the front desk. */

export function Modal({ title, onClose, children, size }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose && onClose()}>
      <div className={`editCard ${size || ""}`}>
        {onClose && (
          <button className="closeX" onClick={onClose} aria-label="Close">
            ✕
          </button>
        )}
        {title && <h2 className="editTitle">{title}</h2>}
        {children}
      </div>
    </div>
  );
}

export function Money({ v, className }) {
  return <span className={className}>{fmtMoney(v)}</span>;
}

export const fmtDate = (ts) =>
  ts ? new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
export const fmtDateTime = (ts) =>
  ts
    ? new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "—";
export const fmtPhone = (p) => {
  const d = String(p || "").replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === "1") return fmtPhone(d.slice(1));
  return p || "";
};

export function Field({ label, children, className }) {
  return (
    <label className={`fld ${className || ""}`}>
      {label && <span>{label}</span>}
      {children}
    </label>
  );
}

export function Text({ value, onChange, ...rest }) {
  return <input value={value == null ? "" : value} onChange={(e) => onChange(e.target.value)} {...rest} />;
}
export function Num({ value, onChange, ...rest }) {
  return (
    <input
      inputMode="decimal"
      value={value == null ? "" : value}
      onChange={(e) => onChange(e.target.value.replace(/[^0-9.-]/g, ""))}
      {...rest}
    />
  );
}
export const toNum = (v) => (Number.isFinite(Number(v)) && v !== "" ? Number(v) : 0);

/* "Are you sure?" with a red button. */
export function ConfirmModal({ title, children, confirmText, onConfirm, onClose }) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="muted" style={{ marginTop: 0, lineHeight: 1.5 }}>{children}</div>
      <div className="rowBtns" style={{ marginTop: 14 }}>
        <button className="btn danger lg" onClick={onConfirm}>
          {confirmText || "Yes, delete it"}
        </button>
        <button className="btn lg" onClick={onClose}>
          Keep it
        </button>
      </div>
    </Modal>
  );
}
