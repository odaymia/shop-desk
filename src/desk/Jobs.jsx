import { useState } from "react";
import { Modal, Field, Text, Money, toNum, ConfirmModal } from "./ui.jsx";
import { PartPicker } from "./pickers.jsx";

import { jobLines, orderTotals, PART_CONDITIONS } from "../lib/invoice.js";
import { uid } from "../lib/ids.js";

/* Canned jobs: a bundle of parts and labor that drops onto a ticket in one
   tap. "Full synthetic oil change" = 5 qt oil + filter + 0.4 hr labor. */

const blank = () => ({ name: "", category: "", unit: "", lines: [], active: true });
const blankLine = (kind) =>
  kind === "labor"
    ? { kind, description: "", details: "", hours: 0.5, rate: null }
    : kind === "fee"
    ? { kind, description: "", qty: 1, price: 0 }
    : { kind, description: "", number: "", partId: null, qty: 1, price: null, cost: null, condition: "new" };
const lineText = (l, parts, unit) =>
  l.kind === "labor"
    ? unit && l.perUnit
      ? `${l.description || "labor"} $${Number(l.rate || 0).toFixed(2)}/${unit}`
      : `${l.hours} hr ${l.description || "labor"}`
    : `${l.qty}× ${l.description || l.number || (parts && parts[l.partId] && parts[l.partId].description) || l.kind}${
        l.kind === "fee" ? ` $${Number(l.price || 0).toFixed(2)}` : ""
      }`;

export function Jobs({ shop, cfg, flash }) {
  const [edit, setEdit] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [showRetired, setShowRetired] = useState(false);
  /* deleted jobs are gone for good; retired ones can come back */
  const rows = Object.values(shop.jobs)
    .filter((j) => !j.deleted && (showRetired ? j.active === false : j.active !== false))
    .sort((a, b) => (a.category || "").localeCompare(b.category || "") || a.name.localeCompare(b.name));
  const retiredCount = Object.values(shop.jobs).filter((j) => !j.deleted && j.active === false).length;
  const priceOf = (job) => orderTotals({ lines: jobLines(job, cfg, shop.parts, uid), noSupplies: true }, cfg).subtotal;

  return (
    <>
      <header className="deskHead">
        <h1>Canned jobs</h1>
        <div className="seg">
          <button className={!showRetired ? "on" : ""} onClick={() => setShowRetired(false)}>
            In use
          </button>
          <button className={showRetired ? "on" : ""} onClick={() => setShowRetired(true)}>
            Retired{retiredCount ? ` (${retiredCount})` : ""}
          </button>
        </div>
        <div className="grow" />
        <button className="btn primary" onClick={() => setEdit(blank())}>
          Add job
        </button>
      </header>
      <div className="deskBody">
        <div className="tableCard">
          <table className="dk">
            <thead>
              <tr>
                <th>Job</th>
                <th>Category</th>
                <th>What's in it</th>
                <th className="r">Price today</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="emptyNote">
                    {showRetired ? "No retired jobs." : "No canned jobs yet. Build one for each service you sell every day so a ticket is two taps, not ten."}
                  </td>
                </tr>
              )}
              {rows.map((j) => (
                <tr key={j.id} className="row" onClick={() => setEdit({ ...blank(), ...j })}>
                  <td>
                    <strong>{j.name}</strong>
                  </td>
                  <td className="muted">{j.category}</td>
                  <td className="muted">
                    {j.unit ? `Per ${j.unit}: ` : ""}
                    {j.lines.map((l) => lineText(l, shop.parts, j.unit)).join(", ")}
                  </td>
                  <td className="r num">
                    <Money v={priceOf(j)} />
                    {j.unit ? <span className="sub">per {j.unit}</span> : null}
                  </td>
                  <td className="r">
                    <span className="rowActs">
                      {showRetired && (
                        <button
                          className="btn tiny"
                          onClick={async (e) => {
                            e.stopPropagation();
                            await shop.saveJob({ ...j, active: true });
                            flash(`${j.name} is back in use`);
                          }}
                        >
                          Bring back
                        </button>
                      )}
                      <button
                        className="btn tiny danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          setToDelete(j);
                        }}
                      >
                        Delete
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="legalNote">
          A job line with no price uses the inventory part's current price, or the shop labor rate, at the moment it's added
          to a ticket. Set a price on the line to lock it.
        </p>
        <p className="legalNote">
          California Bureau of Automotive Repair rules (16 CCR 3353 and 3356): every service and every part is listed and
          priced on its own, in plain language; each part says whether it's new, used, rebuilt, or reconditioned; and a
          generic "shop supplies" or "miscellaneous parts" charge is not allowed. A canned job here is a bundle of separate
          lines, so it already prints itemized. The one thing to keep doing: describe each line, and mark any part that
          isn't new.
        </p>
      </div>
      {toDelete && (
        <ConfirmModal
          title={`Delete ${toDelete.name}?`}
          onClose={() => setToDelete(null)}
          onConfirm={async () => {
            await shop.saveJob({ ...toDelete, active: false, deleted: true });
            setToDelete(null);
            flash(`${toDelete.name} deleted`, "out");
          }}
        >
          <p style={{ marginTop: 0 }}>Are you sure you want to delete this? This cannot be reversed.</p>
          <p>Tickets that already used this job keep their lines. To hide it but keep the option to bring it back, retire it instead.</p>
        </ConfirmModal>
      )}
      {edit && (
        <JobForm
          job={edit}
          shop={shop}
          cfg={cfg}
          onClose={() => setEdit(null)}
          onSave={async (j) => {
            await shop.saveJob(j);
            setEdit(null);
            flash("Job saved");
          }}
        />
      )}
    </>
  );
}

function JobForm({ job, shop, cfg, onClose, onSave }) {
  const [d, setD] = useState(job);
  const [pickFor, setPickFor] = useState(null); // line index
  const [err, setErr] = useState("");
  const setLine = (i, patch) => setD((x) => ({ ...x, lines: x.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) }));
  const add = (kind) => setD((x) => ({ ...x, lines: [...x.lines, blankLine(kind)] }));
  const remove = (i) => setD((x) => ({ ...x, lines: x.lines.filter((_, k) => k !== i) }));
  const numOrNull = (v) => (v === "" || v == null ? null : toNum(v));

  return (
    <>
      <Modal title={d.id ? "Edit job" : "New canned job"} onClose={onClose} size="xwide">
        <div className="fldRow">
          <Field label="Job name (what the customer sees)">
            <Text value={d.name} onChange={(v) => setD({ ...d, name: v })} autoFocus placeholder="Full synthetic oil change" />
          </Field>
          <Field label="Category">
            <Text value={d.category} onChange={(v) => setD({ ...d, category: v })} placeholder="Oil, Brakes, Tires…" />
          </Field>
          <Field label="Priced per (leave blank for a fixed job)">
            <Text value={d.unit || ""} onChange={(v) => setD({ ...d, unit: v.trim().toLowerCase() })} placeholder="tire, wheel, quart" />
          </Field>
        </div>
        {d.unit && (
          <p className="noteBox">
            When this job goes on a ticket you'll be asked how many {d.unit}s. Lines with “× count” checked multiply by
            that number; the rest are added once.
          </p>
        )}
        <div className="subhead">Lines</div>
        <div className="miniLines">
          {d.lines.map((l, i) => (
            <div className={`miniLine ${d.unit ? "unit" : ""}`} key={i}>
              <select value={l.kind} onChange={(e) => setLine(i, blankLine(e.target.value))}>
                <option value="part">Part</option>
                <option value="labor">Labor</option>
                <option value="fee">Fee</option>
              </select>
              {l.kind === "part" ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    style={{ flex: 1 }}
                    value={l.description}
                    onChange={(e) => setLine(i, { description: e.target.value })}
                    placeholder={l.partId ? shop.parts[l.partId]?.description : "Description, or pick from inventory →"}
                  />
                  <button className="btn tiny" onClick={() => setPickFor(i)}>
                    {l.partId ? shop.parts[l.partId]?.number || "Inventory" : "Inventory"}
                  </button>
                  <select value={l.condition || "new"} onChange={(e) => setLine(i, { condition: e.target.value })} title="Part condition (required on California invoices)" style={{ width: 120 }}>
                    {PART_CONDITIONS.map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : l.kind === "labor" ? (
                <div className="laborCell">
                  <input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="Replace front brake pads" />
                  <input
                    value={l.details || ""}
                    onChange={(e) => setLine(i, { details: e.target.value })}
                    placeholder="Details that print under it: what's included, warranty, notes"
                  />
                </div>
              ) : (
                <input
                  value={l.description}
                  onChange={(e) => setLine(i, { description: e.target.value })}
                  placeholder="CA tire recycling fee"
                />
              )}
              {l.kind === "labor" ? (
                <input inputMode="decimal" value={l.hours} onChange={(e) => setLine(i, { hours: toNum(e.target.value) })} title={d.unit && l.perUnit ? `Per ${d.unit}` : "Hours"} />
              ) : (
                <input inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: toNum(e.target.value) })} title="Quantity" />
              )}
              {l.kind === "fee" ? (
                <input inputMode="decimal" value={l.price == null ? "" : l.price} onChange={(e) => setLine(i, { price: toNum(e.target.value) })} placeholder="amount" title="Fee amount" />
              ) : l.kind === "part" ? (
                <input
                  inputMode="decimal"
                  value={l.price == null ? "" : l.price}
                  onChange={(e) => setLine(i, { price: numOrNull(e.target.value) })}
                  placeholder={l.partId ? `$${toNum(shop.parts[l.partId]?.price).toFixed(2)}` : "price"}
                  title="Price each — blank uses inventory price"
                />
              ) : (
                <input
                  inputMode="decimal"
                  value={l.rate == null ? "" : l.rate}
                  onChange={(e) => setLine(i, { rate: numOrNull(e.target.value) })}
                  placeholder={d.unit && l.perUnit ? `$ per ${d.unit}` : `$${toNum(cfg.laborRate)}/hr`}
                  title={d.unit && l.perUnit ? `Flat amount per ${d.unit}` : "Rate — blank uses the shop rate"}
                />
              )}
              {d.unit && (
                <label className="perUnit" title={`Multiply by the number of ${d.unit}s`}>
                  <input type="checkbox" checked={!!l.perUnit} onChange={(e) => setLine(i, { perUnit: e.target.checked })} />
                  <span>× count</span>
                </label>
              )}
              <button className="lineX" onClick={() => remove(i)} aria-label="Remove">
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="addBar">
          <button className="btn tiny" onClick={() => add("part")}>
            + Part
          </button>
          <button className="btn tiny" onClick={() => add("labor")}>
            + Labor
          </button>
          <button className="btn tiny" onClick={() => add("fee")}>
            + Fee
          </button>
        </div>
        {d.id && (
          <label className="fld inline" style={{ marginTop: 16 }}>
            <input type="checkbox" checked={d.active === false} onChange={(e) => setD({ ...d, active: !e.target.checked })} />
            <span>Retire this job</span>
          </label>
        )}
        {err && <p className="fldErr">{err}</p>}
        <button
          className="btn primary lg full"
          onClick={() => {
            if (!d.name.trim()) return setErr("The job needs a name.");
            if (!d.lines.length) return setErr("Add at least one line.");
            const blank = d.lines.find((l) => !(l.description || "").trim() && !(l.kind === "part" && l.partId));
            if (blank) return setErr("Every line needs a description the customer can understand. California requires each service and each part to be described on the invoice.");
            onSave({ ...d, name: d.name.trim() });
          }}
        >
          Save job
        </button>
      </Modal>
      {pickFor != null && (
        <PartPicker
          shop={shop}
          onClose={() => setPickFor(null)}
          onPick={(p) => {
            setLine(pickFor, { partId: p.id, number: p.number, description: p.description });
            setPickFor(null);
          }}
        />
      )}
    </>
  );
}
