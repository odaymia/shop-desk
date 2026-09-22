import { useMemo, useState } from "react";
import { Modal } from "./ui.jsx";
import { symptomGroups, parseConcern, composeConcern, categoryMeta } from "../lib/symptoms.js";

const OTHER = "__other__";

/* The guided "Customer states" builder. Tap every concern in plain, everyday
   language and it's written onto the ticket the way the California BAR "Write
   It Right" guide wants — a specific job description the customer understands.
   Categories are tabs so the list isn't a long scroll, with a live preview of
   what prints. Reusable for the front desk and the customer-facing tablet. */
export function ConcernBuilder({ cfg, value, onSave, onClose, forCustomer }) {
  const groups = useMemo(() => symptomGroups(cfg), [cfg]);
  const init = useMemo(() => parseConcern(value, cfg), [value, cfg]);
  const [picked, setPicked] = useState(() => new Set(init.selected.map((s) => s.toLowerCase())));
  const [extra, setExtra] = useState(init.extra);
  const [tab, setTab] = useState(() => (groups[0] ? groups[0][0] : OTHER));

  const toggle = (item) =>
    setPicked((prev) => {
      const next = new Set(prev);
      const k = item.toLowerCase();
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const countIn = (items) => items.reduce((n, i) => n + (picked.has(i.toLowerCase()) ? 1 : 0), 0);
  const activeItems = (groups.find(([cat]) => cat === tab) || [null, []])[1];

  /* selected symptoms in the taxonomy's order, so the concern reads the same
     no matter what order or tab they were tapped */
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
          ? "Pick a topic, then tap anything you've noticed. Nothing's wrong to tap — just tell us what you see, hear, or feel."
          : "Pick a category, then tap everything the customer mentions. It prints in plain language, the way BAR wants it written."}
      </p>
      <div className="concernBody">
        <div className="concernMain">
          <div className="symTabs">
            {groups.map(([cat]) => {
              const m = categoryMeta(cat);
              const n = countIn((groups.find(([c]) => c === cat) || [null, []])[1]);
              return (
                <button key={cat} type="button" className={`symTab ${tab === cat ? "on" : ""}`} onClick={() => setTab(cat)}>
                  <span className="symTabIcon">{m.icon}</span>
                  {m.short}
                  {n > 0 && <span className="symTabCount">{n}</span>}
                </button>
              );
            })}
            <button type="button" className={`symTab ${tab === OTHER ? "on" : ""}`} onClick={() => setTab(OTHER)}>
              <span className="symTabIcon">✏️</span>
              Other
              {extra.trim() && <span className="symTabCount">•</span>}
            </button>
          </div>

          <div className="symTabBody">
            {tab === OTHER ? (
              <>
                <div className="symCat">In your own words</div>
                <textarea
                  className="ta"
                  rows={4}
                  value={extra}
                  onChange={(e) => setExtra(e.target.value)}
                  placeholder={forCustomer ? "Anything else you'd like us to know…" : "Anything the customer said that isn't on a tab…"}
                />
              </>
            ) : (
              <div className="symChips">
                {activeItems.map((item) => {
                  const on = picked.has(item.toLowerCase());
                  return (
                    <button key={item} type="button" className={`symChip ${on ? "on" : ""}`} onClick={() => toggle(item)}>
                      {on ? "✓ " : ""}
                      {item}
                    </button>
                  );
                })}
              </div>
            )}
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
