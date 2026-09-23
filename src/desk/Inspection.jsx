import { useState, useEffect, useMemo } from "react";
import { Text, Num } from "./ui.jsx";
import { inspectionSummary, inspectionRecommendations, INSPECTION_STATES, FLAGGED } from "../lib/inspection.js";
import { photoToDataUrl } from "./photo.js";
import { sGet, sSet } from "../storage/index.js";
import { uid } from "../lib/ids.js";

/* Digital Vehicle Inspection — the tech's walk-around on a tablet. Each point
   gets Good / Attention / Needs service / N/A, plus notes and photos, and the
   flagged points carry a recommendation (label + price) that can be dropped
   onto the estimate. Photos go to the media store; the order keeps the keys. */
export function Inspection({ order, cfg, employees, flash, onClose, onSave, onAddToEstimate }) {
  const template = useMemo(() => cfg.inspection || [], [cfg.inspection]);
  const [items, setItems] = useState(() => (order.inspection && order.inspection.items ? clone(order.inspection.items) : seed(template)));
  const [by, setBy] = useState((order.inspection && order.inspection.by) || "");
  const [pics, setPics] = useState({}); // mediaKey -> data URL, for display
  const [busy, setBusy] = useState(false);

  // load photos already on file
  useEffect(() => {
    let live = true;
    const keys = [];
    for (const id in items) for (const k of items[id].photos || []) keys.push(k);
    (async () => {
      for (const k of keys) {
        try {
          const d = await sGet(k);
          if (live && d) setPics((p) => ({ ...p, [k]: d }));
        } catch { /* missing media */ }
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const item = (id) => items[id] || { status: "", note: "", photos: [] };
  const setItem = (id, patch) => setItems((m) => ({ ...m, [id]: { ...item(id), ...patch } }));

  const addPhoto = async (id, file) => {
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await photoToDataUrl(file);
      const key = `sd:photo:${Date.now()}:${uid()}`;
      await sSet(key, dataUrl);
      setPics((p) => ({ ...p, [key]: dataUrl }));
      setItem(id, { photos: [...item(id).photos, key] });
    } catch (e) {
      flash(e.message || "Couldn't add the photo", "out");
    }
    setBusy(false);
  };
  const removePhoto = (id, key) => setItem(id, { photos: item(id).photos.filter((k) => k !== key) });

  const summary = inspectionSummary({ items });
  const recs = inspectionRecommendations({ items }, template);
  const recTotal = recs.reduce((a, r) => a + (Number(r.price) || 0), 0);

  const persist = () => onSave({ at: (order.inspection && order.inspection.at) || Date.now(), by, items });
  const save = async () => {
    await persist();
    onClose();
  };
  const addWork = async () => {
    await persist();
    onAddToEstimate(recs);
  };

  return (
    <div className="inspScreen">
      <header className="deskHead inspHead">
        <button className="btn ghost" onClick={onClose}>← Ticket</button>
        <h1>Vehicle inspection</h1>
        <div className="grow" />
        <span className="inspTally">
          <b className="vGood">{summary.good} OK</b>
          <b className="vAdvise">{summary.advise} !</b>
          <b className="vFail">{summary.fail} ✕</b>
          {summary.pending ? <b className="muted">{summary.pending} left</b> : null}
        </span>
        <button className="btn" onClick={save}>Save &amp; close</button>
        <button className="btn primary" disabled={!recs.length} onClick={addWork}>
          Add {recs.length || ""} to estimate{recTotal ? ` · ${money(recTotal)}` : ""}
        </button>
      </header>
      <div className="deskBody inspBody">
        <label className="fld" style={{ maxWidth: 320 }}>
          <span>Inspected by</span>
          <select value={by} onChange={(e) => setBy(e.target.value)}>
            <option value="">—</option>
            {(employees || []).map((e) => (
              <option key={e.id} value={e.name}>{e.name}</option>
            ))}
          </select>
        </label>

        {template.map((cat) => (
          <section key={cat.name} className="inspCat">
            <h3 className="subhead">{cat.name}</h3>
            {(cat.items || []).map((def) => {
              const it = item(def.id);
              const flagged = FLAGGED.includes(it.status);
              return (
                <div key={def.id} className={`inspItem ${it.status ? "set" : ""}`}>
                  <div className="inspRow">
                    <span className="inspLabel">{def.label}</span>
                    <div className="inspStates">
                      {INSPECTION_STATES.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className={`inspState ${s.id} ${it.status === s.id ? "on" : ""}`}
                          onClick={() => setItem(def.id, { status: it.status === s.id ? "" : s.id })}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {(flagged || it.note || it.photos.length > 0) && (
                    <div className="inspDetail">
                      <div className="inspPhotos">
                        {it.photos.map((k) => (
                          <span key={k} className="inspThumb">
                            {pics[k] ? <img src={pics[k]} alt="" /> : <span className="inspThumbLoad" />}
                            <button type="button" className="inspThumbX" onClick={() => removePhoto(def.id, k)} aria-label="Remove photo">✕</button>
                          </span>
                        ))}
                        <label className="inspAddPhoto">
                          <input type="file" accept="image/*" capture="environment" hidden disabled={busy} onChange={(e) => { addPhoto(def.id, e.target.files[0]); e.target.value = ""; }} />
                          📷 Photo
                        </label>
                      </div>
                      <Text value={it.note} onChange={(v) => setItem(def.id, { note: v })} placeholder="Note (what you saw)" />
                      {flagged && (
                        <div className="inspRec">
                          <Text value={it.recLabel ?? def.recLabel ?? ""} onChange={(v) => setItem(def.id, { recLabel: v })} placeholder="Recommended work" />
                          <div className="inspRecPrice">
                            <span>$</span>
                            <Num value={it.recPrice ?? def.recPrice ?? ""} onChange={(v) => setItem(def.id, { recPrice: v })} placeholder="0" />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

/* A compact read-out for the ticket, so the writer sees the inspection at a
   glance, reopens it, or texts it to the customer. */
export function InspectionCard({ order, onOpen, onSend }) {
  const insp = order.inspection;
  const s = inspectionSummary(insp || { items: {} });
  if (!insp) {
    return (
      <button className="btn full" onClick={onOpen}>
        📋 Start vehicle inspection
      </button>
    );
  }
  return (
    <div className="inspCardBox">
      <button className="inspCardBtn" onClick={onOpen}>
        <span className="inspCardTitle">Vehicle inspection</span>
        <span className="inspCardStats">
          <b className="vGood">{s.good} OK</b>
          <b className="vAdvise">{s.advise} attention</b>
          <b className="vFail">{s.fail} needs service</b>
          {s.photos ? <b className="muted">{s.photos} 📷</b> : null}
          {s.pending ? <b className="muted">{s.pending} left</b> : null}
        </span>
      </button>
      <div className="rowBtns" style={{ marginTop: 10 }}>
        <button className="btn" onClick={onOpen}>Open / edit</button>
        <button className="btn primary" onClick={onSend}>📲 Text report to customer</button>
      </div>
    </div>
  );
}

function seed(template) {
  const items = {};
  for (const cat of template || []) for (const it of cat.items || []) items[it.id] = { status: "", note: "", photos: [] };
  return items;
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
