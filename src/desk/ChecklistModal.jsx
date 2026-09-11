import { useState, useEffect, useRef } from "react";
import { Modal } from "./ui.jsx";
import { startChecklist, optionsOf, cycle, withDepthDefault, displayValue } from "../lib/checklist.js";

/* The service checklist, driven from the keyboard: Enter takes the
   answer and moves on, Space (or the arrows) picks a different one,
   1–9 jumps straight to a choice, Backspace goes back. Items whose
   part or service is on the ticket start at Replaced. Closing saves. */
export function ChecklistModal({ cfg, order, prior, onSave, onCancel }) {
  const cfgItems = cfg.checklist && cfg.checklist.length ? cfg.checklist : undefined;
  const [items, setItems] = useState(() =>
    order.checklist && order.checklist.items && order.checklist.items.length ? order.checklist.items.map((x) => ({ ...x })) : startChecklist(cfgItems, order.lines, prior)
  );
  const [idx, setIdx] = useState(0);
  const inputRef = useRef(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const cur = items[idx];
  const opts = cur && cur.kind === "choice" ? optionsOf(cur, cfgItems) : [];

  const setVal = (v) => setItems((a) => a.map((x, i) => (i === idx ? { ...x, value: v } : x)));
  const finish = () => onSave(itemsRef.current);
  const go = (n) => {
    if (n < 0) return;
    if (n >= items.length) return finish();
    setItems((a) => withDepthDefault(a, n));
    setIdx(n);
  };

  useEffect(() => {
    if (cur && cur.kind !== "choice" && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [idx, cur]);

  useEffect(() => {
    const onKey = (e) => {
      if (!cur || e.metaKey || e.ctrlKey || e.altKey) return;
      const inText = e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA");
      if (e.key === "Enter") {
        e.preventDefault();
        go(idx + 1);
        return;
      }
      if (cur.kind !== "choice" && inText) return; // typing a number or pressure
      if (e.key === " " || e.code === "Space" || e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        if (opts.length) setVal(cycle(opts, cur.value, 1));
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        if (opts.length) setVal(cycle(opts, cur.value, -1));
      } else if (e.key === "Backspace") {
        e.preventDefault();
        go(idx - 1);
      } else if (/^[1-9]$/.test(e.key) && opts[Number(e.key) - 1]) {
        e.preventDefault();
        setVal(opts[Number(e.key) - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!cur) return null;
  return (
    <Modal title="Service checklist" onClose={finish} size="xwide">
      <div className="ckWrap">
        <ol className="ckList">
          {items.map((it, i) => (
            <li key={it.id} className={i === idx ? "cur" : i < idx ? "done" : ""} onClick={() => go(i)}>
              <span className="n">{i + 1}</span>
              <span className="lbl">{it.label}</span>
              <span className="val">{displayValue(it) || "—"}</span>
            </li>
          ))}
        </ol>
        <div className="ckCur">
          <div className="ckStep">
            {idx + 1} of {items.length}
          </div>
          <h3>{cur.label}</h3>
          {cur.auto && <p className="muted" style={{ marginTop: 0 }}>On this ticket, so it's marked Replaced.</p>}
          {cur.kind === "choice" ? (
            <div className="ckOpts">
              {opts.map((o, i) => (
                <button
                  key={o}
                  className={`btn ${o === cur.value ? "primary" : ""}`}
                  onClick={(e) => {
                    setVal(o);
                    e.currentTarget.blur();
                  }}
                >
                  <kbd>{i + 1}</kbd>
                  {o}
                </button>
              ))}
            </div>
          ) : (
            <div className="ckText">
              <input
                ref={inputRef}
                inputMode={cur.kind === "depth" ? "numeric" : "text"}
                value={cur.value || ""}
                onChange={(e) => setVal(cur.kind === "depth" ? e.target.value.replace(/[^0-9]/g, "").slice(0, 2) : e.target.value)}
                placeholder={cur.kind === "depth" ? "8" : "F35 R35"}
              />
              {cur.kind === "depth" && <span className="muted">/32nds</span>}
            </div>
          )}
          <div className="ckKeys">
            <b>Enter</b> next · <b>Space</b> or arrows change · <b>1–9</b> pick · <b>Backspace</b> back · <b>Esc</b> saves and closes
          </div>
          <div className="rowBtns">
            <button className="btn primary" onClick={() => go(idx + 1)}>
              {idx === items.length - 1 ? "Done" : "Next"}
            </button>
            <button className="btn ghost" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* The filled checklist on the ticket */
export function ChecklistCard({ order, locked, onOpen }) {
  const items = order.checklist && order.checklist.items ? order.checklist.items : null;
  if (!items && locked) return null;
  return (
    <div className="card">
      <div className="cardHead">
        <h3>Service checklist</h3>
        {!locked && (
          <button className="btn tiny" onClick={onOpen}>
            {items ? "Edit" : "Start"}
          </button>
        )}
      </div>
      {items ? (
        <div className="ckGrid">
          {items.map((it) => (
            <div key={it.id} style={{ display: "contents" }}>
              <span>{it.label}</span>
              <strong>{displayValue(it) || "—"}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          Not done yet. It opens on its own when an oil change goes on the ticket.
        </p>
      )}
    </div>
  );
}
