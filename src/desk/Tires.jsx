import { useState, useMemo } from "react";
import { Modal, Field, Text, Num, Money, toNum } from "./ui.jsx";
import { activeList, searchText } from "./useShop.js";
import { normalizeTireSize, isTireSize, tireSizeKey, tireBrandModel, tireName } from "../lib/tires.js";

/* Tires are inventory parts with `tire: true` and a size, so tickets,
   stock counts, and canned jobs treat them like any part. This page is
   where they're managed, organized the way a tire rack is: by size. */

const blank = () => ({
  tire: true,
  brand: "",
  model: "",
  size: "",
  number: "",
  description: "",
  category: "Tires",
  vendorId: "",
  cost: "",
  price: "",
  onHand: 0,
  reorderAt: 0,
  location: "",
  taxable: true,
  active: true,
});

export function Tires({ shop, flash }) {
  const [q, setQ] = useState("");
  const [only, setOnly] = useState("all"); // all | stock | low
  const [edit, setEdit] = useState(null);
  const vendors = activeList(shop.vendors).sort((a, b) => a.name.localeCompare(b.name));
  const all = useMemo(() => activeList(shop.parts).filter((p) => p.tire), [shop.parts]);

  const rows = useMemo(
    () =>
      all
        .filter((p) => searchText(q, p.size, tireName(p), p.number, p.location, (shop.vendors[p.vendorId] || {}).name))
        .filter((p) => (only === "stock" ? toNum(p.onHand) > 0 : only === "low" ? toNum(p.reorderAt) > 0 && toNum(p.onHand) <= toNum(p.reorderAt) : true))
        .sort((a, b) => {
          const ka = tireSizeKey(a.size), kb = tireSizeKey(b.size);
          return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || tireName(a).localeCompare(tireName(b));
        }),
    [all, shop.vendors, q, only]
  );
  const onHandTotal = all.reduce((a, p) => a + toNum(p.onHand), 0);
  const sizes = new Set(all.filter((p) => toNum(p.onHand) > 0).map((p) => p.size)).size;
  const low = all.filter((p) => toNum(p.reorderAt) > 0 && toNum(p.onHand) <= toNum(p.reorderAt)).length;

  return (
    <>
      <header className="deskHead">
        <h1>Tires</h1>
        <div className="seg">
          <button className={only === "all" ? "on" : ""} onClick={() => setOnly("all")}>
            All
          </button>
          <button className={only === "stock" ? "on" : ""} onClick={() => setOnly("stock")}>
            On hand
          </button>
          <button className={only === "low" ? "on" : ""} onClick={() => setOnly("low")}>
            Low{low ? ` (${low})` : ""}
          </button>
        </div>
        <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Size (225/65R17), brand, model" />
        <div className="grow" />
        <span className="muted">
          {onHandTotal} tires on hand · {sizes} size{sizes === 1 ? "" : "s"}
        </span>
        <button className="btn primary" onClick={() => setEdit(blank())}>
          Add tire
        </button>
      </header>
      <div className="deskBody">
        <div className="tableCard scroll">
          <table className="dk">
            <thead>
              <tr>
                <th>Size</th>
                <th>Tire</th>
                <th>Part #</th>
                <th>Vendor</th>
                <th>Rack</th>
                <th className="r">On hand</th>
                <th className="r">Cost</th>
                <th className="r">Price</th>
                <th className="r">Margin</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="emptyNote">
                    {q ? "No tires match." : "No tires yet. Add the sizes you stock; anything you order per job can be added here too so it prints with its size."}
                  </td>
                </tr>
              )}
              {rows.map((p) => {
                const lowRow = toNum(p.reorderAt) > 0 && toNum(p.onHand) <= toNum(p.reorderAt);
                const margin = toNum(p.price) > 0 ? ((toNum(p.price) - toNum(p.cost)) / toNum(p.price)) * 100 : 0;
                return (
                  <tr key={p.id} className="row" onClick={() => setEdit({ ...blank(), ...p, ...tireBrandModel(p) })}>
                    <td className="num">
                      <strong>{p.size || "—"}</strong>
                      {p.loadSpeed ? <span className="muted"> {p.loadSpeed}</span> : null}
                    </td>
                    <td>{tireName(p)}</td>
                    <td className="num muted">{p.number}</td>
                    <td className="muted">{(shop.vendors[p.vendorId] || {}).name || ""}</td>
                    <td className="muted">{p.location}</td>
                    <td className="r num" style={lowRow ? { color: "var(--warn)", fontWeight: 600 } : null}>
                      {toNum(p.onHand)}
                      {lowRow ? <span className="sub">reorder at {toNum(p.reorderAt)}</span> : null}
                    </td>
                    <td className="r num">
                      <Money v={p.cost} />
                    </td>
                    <td className="r num">
                      <Money v={p.price} />
                    </td>
                    <td className="r num muted">{toNum(p.price) > 0 ? `${margin.toFixed(0)}%` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="legalNote">
          A tire goes on a ticket like any part: + Part on the ticket, or the Tires canned job. Posting an invoice takes it
          off the rack. Sizes print on the ticket next to the tire name.
        </p>
      </div>
      {edit && (
        <TireForm
          tire={edit}
          vendors={vendors}
          onClose={() => setEdit(null)}
          onSave={async (p) => {
            await shop.savePart(p);
            setEdit(null);
            flash("Tire saved");
          }}
        />
      )}
    </>
  );
}

function TireForm({ tire, vendors, onClose, onSave }) {
  const [d, setD] = useState(tire);
  const [err, setErr] = useState("");
  const set = (k) => (v) => setD((x) => ({ ...x, [k]: v }));
  const save = () => {
    const size = normalizeTireSize(d.size);
    if (!isTireSize(size)) return setErr("Enter the size the way it reads on the sidewall, like 225/65R17.");
    if (!d.brand.trim()) return setErr("Which brand?");
    const description = [d.brand.trim(), d.model.trim()].filter(Boolean).join(" ");
    onSave({
      ...d,
      tire: true,
      size,
      brand: d.brand.trim(),
      model: d.model.trim(),
      description,
      category: "Tires",
      number: d.number.trim().toUpperCase(),
      cost: toNum(d.cost),
      price: toNum(d.price),
      onHand: toNum(d.onHand),
      reorderAt: toNum(d.reorderAt),
    });
  };
  return (
    <Modal title={d.id ? "Edit tire" : "Add tire"} onClose={onClose} size="wide">
      <div className="fldRow">
        <Field label="Size">
          <Text
            value={d.size}
            onChange={set("size")}
            onBlur={() => set("size")(normalizeTireSize(d.size))}
            placeholder="225/65R17"
            autoFocus
            style={{ fontSize: 22, letterSpacing: ".04em", fontWeight: 600 }}
          />
        </Field>
        <Field label="Brand">
          <Text value={d.brand} onChange={set("brand")} placeholder="Michelin" list="tireBrands" />
        </Field>
        <Field label="Model">
          <Text value={d.model} onChange={set("model")} placeholder="Defender 2" />
        </Field>
      </div>
      <div className="fldRow">
        <Field label="Part # / SKU">
          <Text value={d.number} onChange={set("number")} placeholder="From the vendor invoice" />
        </Field>
        <Field label="Vendor">
          <select value={d.vendorId || ""} onChange={(e) => set("vendorId")(e.target.value)}>
            <option value="">—</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="fldRow">
        <Field label="Cost each">
          <Num value={d.cost} onChange={set("cost")} />
        </Field>
        <Field label="Sell price each">
          <Num value={d.price} onChange={set("price")} />
        </Field>
        <Field label="On hand">
          <Num value={d.onHand} onChange={set("onHand")} />
        </Field>
        <Field label="Reorder at">
          <Num value={d.reorderAt} onChange={set("reorderAt")} />
        </Field>
      </div>
      <Field label="Rack / location">
        <Text value={d.location} onChange={set("location")} placeholder="Rack B, row 3" />
      </Field>
      {d.id && (
        <label className="fld inline">
          <input type="checkbox" checked={d.active === false} onChange={(e) => set("active")(!e.target.checked)} />
          <span>No longer stocked (hide from pickers, keep history)</span>
        </label>
      )}
      {err && <p className="fldErr">{err}</p>}
      <button className="btn primary lg full" onClick={save}>
        Save tire
      </button>
    </Modal>
  );
}
