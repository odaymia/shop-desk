import { useState } from "react";
import { Modal, Field, Text, Money, toNum } from "./ui.jsx";
import { PartPicker } from "./pickers.jsx";
import { activeList } from "./useShop.js";
import { jobLines, orderTotals } from "../lib/invoice.js";
import { uid } from "../lib/ids.js";

/* Canned jobs: a bundle of parts and labor that drops onto a ticket in one
   tap. "Full synthetic oil change" = 5 qt oil + filter + 0.4 hr labor. */

const blank = () => ({ name: "", category: "", lines: [], active: true });
const blankLine = (kind) =>
  kind === "labor"
    ? { kind, description: "", hours: 0.5, rate: null }
    : { kind, description: "", number: "", partId: null, qty: 1, price: null, cost: null };

export function Jobs({ shop, cfg, flash }) {
  const [edit, setEdit] = useState(null);
  const rows = activeList(shop.jobs).sort((a, b) => (a.category || "").localeCompare(b.category || "") || a.name.localeCompare(b.name));
  const priceOf = (job) => orderTotals({ lines: jobLines(job, cfg, shop.parts, uid), noSupplies: true }, cfg).subtotal;

  return (
    <>
      <header className="deskHead">
        <h1>Canned jobs</h1>
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
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="emptyNote">
                    No canned jobs yet. Build one for each service you sell every day so a ticket is two taps, not ten.
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
                    {j.lines
                      .map((l) => (l.kind === "labor" ? `${l.hours} hr ${l.description || "labor"}` : `${l.qty}× ${l.description || l.number || "part"}`))
                      .join(", ")}
                  </td>
                  <td className="r num">
                    <Money v={priceOf(j)} />
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
      </div>
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
        </div>
        <div className="subhead">Lines</div>
        <div className="miniLines">
          {d.lines.map((l, i) => (
            <div className="miniLine" key={i}>
              <select value={l.kind} onChange={(e) => setLine(i, blankLine(e.target.value))}>
                <option value="part">Part</option>
                <option value="labor">Labor</option>
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
                </div>
              ) : (
                <input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="Lube, oil, filter" />
              )}
              {l.kind === "part" ? (
                <input inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: toNum(e.target.value) })} title="Quantity" />
              ) : (
                <input inputMode="decimal" value={l.hours} onChange={(e) => setLine(i, { hours: toNum(e.target.value) })} title="Hours" />
              )}
              {l.kind === "part" ? (
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
                  placeholder={`$${toNum(cfg.laborRate)}/hr`}
                  title="Rate — blank uses the shop rate"
                />
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
