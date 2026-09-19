import { useMemo, useState } from "react";
import { Modal } from "./ui.jsx";
import { symptomGroups, parseConcern, composeConcern } from "../lib/symptoms.js";

/* The guided "Customer states" builder. Tap every concern the customer
   mentions and it's written onto the ticket in plain, customer-understandable
   language — the specific job description the California BAR "Write It Right"
   guide requires. A live preview shows exactly what prints. Reusable for the
   front desk and (later) a customer-facing tablet. */
export function ConcernBuilder({ cfg, value, onSave, onClose, forCustomer }) {
  const groups = useMemo(() => symptomGroups(cfg), [cfg]);
  const init = useMemo(() => parseConcern(value, cfg), [value, cfg]);
  const [picked, setPicked] = useState(() => new Set(init.selected.map((s) => s.toLowerCase())));
  const [extra, setExtra] = useState(init.extra);

  const toggle = (item) =>
    setPicked((prev) => {
      const next = new Set(prev);
      const k = item.toLowerCase();
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  /* selected symptoms in the taxonomy's order, so the concern reads the same
     no matter what order they were tapped */
  const selectedInOrder = useMemo(() => groups.flatMap(([, items]) => items).filter((i) => picked.has(i.toLowerCase())), [groups, picked]);
  const preview = composeConcern(selectedInOrder, extra);

  const save = () => {
    onSave(preview);
    onClose();
  };

  return (
    <Modal title={forCustomer ? "What brings you in today?" : "Customer states — concern builder"} onClose={onClose} size="wide">
      <p className="muted" style={{ marginTop: 0 }}>
        {forCustomer
          ? "Tap everything you've noticed. Add anything else in your own words at the bottom."
          : "Tap everything the customer mentions. It prints on the ticket in plain language, the way BAR wants it written."}
      </p>
      <div className="concernBody">
        <div className="concernGroups">
          {groups.map(([cat, items]) => (
            <div key={cat} className="symGroup">
              <div className="symCat">{cat}</div>
              <div className="symChips">
                {items.map((item) => {
                  const on = picked.has(item.toLowerCase());
                  return (
                    <button key={item} type="button" className={`symChip ${on ? "on" : ""}`} onClick={() => toggle(item)}>
                      {on ? "✓ " : ""}
                      {item}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="symGroup">
            <div className="symCat">In their own words (optional)</div>
            <textarea
              className="ta"
              rows={2}
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder={forCustomer ? "Anything else you'd like us to know…" : "Anything the customer said that isn't above…"}
            />
          </div>
        </div>
        <div className="concernPreview">
          <div className="symCat">Prints on the ticket</div>
          {preview ? (
            <ul className="concernList">
              {preview.split("\n").map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ margin: 0 }}>Nothing picked yet.</p>
          )}
          <div className="rowBtns" style={{ marginTop: 16 }}>
            <button className="btn primary" onClick={save} disabled={!preview}>
              {forCustomer ? "Done" : "Add to ticket"}
            </button>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
