import { useState, useRef } from "react";
import { Modal } from "./ui.jsx";
import {
  COUNTERS_KEY,

  customerKey,
  vehicleKey,
  partKey,
  vendorKey,
  jobKey,
  orderKey,
} from "../lib/keys.js";
import { uid } from "../lib/ids.js";
import { sGet, sSet } from "../storage/index.js";
import { specStoreKey } from "../lib/keys.js";
import { planMerge, remap, mergeCustomer, mergeVehicle } from "../lib/importMerge.js";
import { specKey } from "../lib/specs.js";

/* Load an import bundle (tools/m1import/export_m1.py makes one from a
   Mitchell1 Manager SE backup). Ids in the bundle are stable, so running
   it twice updates rather than duplicates. Staff are matched to the
   shared roster by name; new names are added without a PIN. */

const TABLES = [
  ["vendors", vendorKey, "Vendors"],
  ["customers", customerKey, "Customers"],
  ["vehicles", vehicleKey, "Vehicles"],
  ["parts", partKey, "Parts"],
  ["jobs", jobKey, "Canned jobs"],
  ["orders", orderKey, "Tickets"],
  ["specs", specStoreKey, "Service specs"],
];

export function ImportPanel({ roster, saveRoster, flash, shop }) {
  const [bundle, setBundle] = useState(null);
  const [err, setErr] = useState("");
  const [progress, setProgress] = useState(null); // { done, total, label }
  const [finished, setFinished] = useState(false);
  const fileRef = useRef(null);

  const pick = async (file) => {
    setErr("");
    setBundle(null);
    setFinished(false);
    try {
      const j = JSON.parse(await file.text());
      if (j.format !== "shop-desk-import") throw new Error("That file isn't a Shop Desk import bundle.");
      setBundle(j);
    } catch (e) {
      setErr(e.message);
    }
  };

  const run = async () => {
    const b = bundle;
    const total = TABLES.reduce((a, [k]) => a + (b[k] || []).length, 0);
    let done = 0;
    const tick = (label) => {
      done++;
      if (done % 25 === 0 || done === total) setProgress({ done, total, label });
    };
    setProgress({ done: 0, total, label: "Starting" });

    /* staff: match by name, add the rest without a PIN */
    const idMap = {};
    let next = [...roster];
    for (const st of b.staff || []) {
      const hit = next.find((e) => e.name.trim().toLowerCase() === st.name.trim().toLowerCase());
      if (hit) idMap[st.id] = hit.id;
      else {
        const rec = { id: uid(), name: st.name, role: st.role || "", pin: "", active: st.active !== false };
        next.push(rec);
        idMap[st.id] = rec.id;
      }
    }
    if (next.length !== roster.length) await saveRoster(next);

    /* match onto what the shop already has: cars by VIN or plate,
       people by phone or email, so a second system's history lands on
       the same records instead of doubling them */
    const plan = planMerge(b, { customers: shop.customers, vehicles: shop.vehicles });
    for (const [k, keyFn, label] of TABLES) {
      for (const rec of b[k] || []) {
        let r = { ...rec };
        if (k === "customers" && plan.dropCustomers.has(rec.id)) {
          tick(label);
          continue;
        }
        if (k === "customers" || k === "vehicles" || k === "orders") r = remap(k, r, plan);
        if (k === "customers" && plan.customerMap[rec.id] && shop.customers[r.id]) r = mergeCustomer(shop.customers[r.id], r);
        if (k === "vehicles" && plan.vehicleMap[rec.id] && shop.vehicles[r.id]) r = mergeVehicle(shop.vehicles[r.id], r);
        if (k === "specs") {
          r.id = specKey(r).replace(/[^A-Za-z0-9|.-]/g, "_");
          const have = shop.specs && shop.specs[r.id];
          if (have && have.source !== "lubesoft" && have.source !== "import") {
            tick(label);
            continue; // the shop typed this one; don't overwrite
          }
        }
        if (k === "orders") {
          if (r.writerId) r.writerId = idMap[r.writerId] || null;
          if (r.techId) r.techId = idMap[r.techId] || null;
          r.lines = (r.lines || []).map((l) => (l.techId ? { ...l, techId: idMap[l.techId] || null } : l));
        }
        if (!r.createdAt) r.createdAt = Date.now();
        if (!r.updatedAt) r.updatedAt = r.createdAt;
        r.imported = b.source || "import";
        await sSet(keyFn(r.id), r);
        tick(label);
      }
    }
    if (b.nextOrderNumber) {
      const counters = (await sGet(COUNTERS_KEY, null)) || {};
      if (!counters.nextOrder || counters.nextOrder < b.nextOrderNumber) await sSet(COUNTERS_KEY, { ...counters, nextOrder: b.nextOrderNumber });
    }
    setProgress({ done: total, total, label: "Done", merged: plan.counts });
    setFinished(true);
    flash("Import finished");
  };

  return (
    <>
      <h3 className="subhead" style={{ marginTop: 36 }}>
        Import from Mitchell1
      </h3>
      <p className="legalNote" style={{ marginTop: 0 }}>
        Bring over customers, vehicles, history, inventory, and canned jobs from Manager SE. Pick the import file made
        from your Manager SE backup. Running it again later updates the same records rather than doubling them.
      </p>
      <div className="rowBtns" style={{ marginBottom: 12 }}>
        <label className="btn">
          Choose import file
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={(e) => e.target.files && e.target.files[0] && pick(e.target.files[0])}
          />
        </label>
      </div>
      {err && <p className="fldErr">{err}</p>}
      {bundle && !progress && (
        <div className="card" style={{ maxWidth: 560 }}>
          <div className="cardHead">
            <h3>{bundle.source}</h3>
          </div>
          <dl className="kv">
            {TABLES.filter(([k]) => (bundle[k] || []).length).map(([k, , label]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt>{label}</dt>
                <dd className="num">{(bundle[k] || []).length.toLocaleString()}</dd>
              </div>
            ))}
            <dt>Staff</dt>
            <dd className="num">{(bundle.staff || []).length}</dd>
            {bundle.nextOrderNumber && (
              <>
                <dt>Next ticket number</dt>
                <dd className="num">#{bundle.nextOrderNumber}</dd>
              </>
            )}
          </dl>
          <div className="rowBtns" style={{ marginTop: 14 }}>
            <button className="btn primary" onClick={run}>
              Import everything
            </button>
            <button className="btn ghost" onClick={() => setBundle(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {progress && (
        <Modal title={finished ? "Import finished" : "Importing…"} onClose={finished ? () => window.location.reload() : undefined}>
          <p className="muted" style={{ marginTop: 0 }}>
            {progress.label}: {progress.done.toLocaleString()} of {progress.total.toLocaleString()} records
          </p>
          <div style={{ height: 10, background: "var(--panel2)", borderRadius: 6, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.round((100 * progress.done) / Math.max(1, progress.total))}%`, background: "var(--signal)" }} />
          </div>
          {finished ? (
            <>
              {progress.merged && (progress.merged.vehiclesMatched || progress.merged.customersMatched) ? (
                <p className="muted">
                  Matched onto records you already had: {progress.merged.vehiclesMatched} cars and {progress.merged.customersMatched} customers.
                  {progress.merged.customersDropped ? ` ${progress.merged.customersDropped} walk-in placeholders folded into existing owners.` : ""}
                </p>
              ) : null}
              <p className="muted">
                Everything is on this computer. If this desk is signed in to the shop, it's uploading in the background
                now; the Settings page shows how many changes are still waiting.
              </p>
              <button className="btn primary lg full" onClick={() => window.location.reload()}>
                Open the desk
              </button>
            </>
          ) : (
            <p className="legalNote">Leave this window open until it finishes.</p>
          )}
        </Modal>
      )}
    </>
  );
}
