import { useState, useMemo } from "react";
import { Modal, Field, Text, Num, Money, toNum } from "./ui.jsx";
import { activeList, searchText } from "./useShop.js";

const blank = () => ({
  number: "",
  description: "",
  category: "",
  vendorId: "",
  cost: "",
  price: "",
  onHand: 0,
  reorderAt: 0,
  location: "",
  taxable: true,
  active: true,
});

export function Inventory({ shop, flash }) {
  const [q, setQ] = useState("");
  const [only, setOnly] = useState("all"); // all | low
  const [edit, setEdit] = useState(null);
  const vendors = activeList(shop.vendors).sort((a, b) => a.name.localeCompare(b.name));

  const rows = useMemo(
    () =>
      activeList(shop.parts)
        .filter((p) => !p.tire) // tires have their own page
        .filter((p) => searchText(q, p.number, p.description, p.category, p.location, (shop.vendors[p.vendorId] || {}).name))
        .filter((p) => only === "all" || toNum(p.onHand) <= toNum(p.reorderAt))
        .sort((a, b) => (a.category || "").localeCompare(b.category || "") || (a.number || "").localeCompare(b.number || "")),
    [shop.parts, shop.vendors, q, only]
  );
  const value = rows.reduce((a, p) => a + toNum(p.onHand) * toNum(p.cost), 0);
  const low = activeList(shop.parts).filter((p) => !p.tire && toNum(p.onHand) <= toNum(p.reorderAt) && toNum(p.reorderAt) > 0).length;

  return (
    <>
      <header className="deskHead">
        <h1>Inventory</h1>
        <div className="seg">
          <button className={only === "all" ? "on" : ""} onClick={() => setOnly("all")}>
            All parts
          </button>
          <button className={only === "low" ? "on" : ""} onClick={() => setOnly("low")}>
            Low stock{low ? ` (${low})` : ""}
          </button>
        </div>
        <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Part #, description, category" />
        <div className="grow" />
        <span className="muted">
          Stock at cost: <Money v={value} />
        </span>
        <button className="btn primary" onClick={() => setEdit(blank())}>
          Add part
        </button>
      </header>
      <div className="deskBody">
        <div className="tableCard scroll">
          <table className="dk">
            <thead>
              <tr>
                <th>Part #</th>
                <th>Description</th>
                <th>Category</th>
                <th>Vendor</th>
                <th>Bin</th>
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
                    {q ? "No parts match." : "No parts yet. Add the oil, filters, and wipers you stock; anything you buy per job can be typed straight onto the ticket."}
                  </td>
                </tr>
              )}
              {rows.map((p) => {
                const lowRow = toNum(p.reorderAt) > 0 && toNum(p.onHand) <= toNum(p.reorderAt);
                const margin = toNum(p.price) > 0 ? ((toNum(p.price) - toNum(p.cost)) / toNum(p.price)) * 100 : 0;
                return (
                  <tr key={p.id} className="row" onClick={() => setEdit({ ...blank(), ...p })}>
                    <td className="num">
                      <strong>{p.number || "—"}</strong>
                    </td>
                    <td>{p.description}</td>
                    <td className="muted">{p.category}</td>
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
      </div>
      {edit && (
        <PartForm
          part={edit}
          vendors={vendors}
          onClose={() => setEdit(null)}
          onSave={async (p) => {
            await shop.savePart(p);
            setEdit(null);
            flash("Part saved");
          }}
        />
      )}
    </>
  );
}

export function PartForm({ part, vendors, onClose, onSave }) {
  const [d, setD] = useState(part);
  const [err, setErr] = useState("");
  const set = (k) => (v) => setD((x) => ({ ...x, [k]: v }));
  const save = () => {
    if (!d.description.trim() && !d.number.trim()) return setErr("Give it a part number or a description.");
    onSave({
      ...d,
      number: d.number.trim().toUpperCase(),
      description: d.description.trim(),
      cost: toNum(d.cost),
      price: toNum(d.price),
      onHand: toNum(d.onHand),
      reorderAt: toNum(d.reorderAt),
    });
  };
  return (
    <Modal title={d.id ? "Edit part" : "Add part"} onClose={onClose} size="wide">
      <div className="fldRow">
        <Field label="Part number">
          <Text value={d.number} onChange={set("number")} autoFocus placeholder="PH3614" />
        </Field>
        <Field label="Category">
          <Text value={d.category} onChange={set("category")} placeholder="Oil, Filters, Wipers…" list="partCats" />
        </Field>
      </div>
      <Field label="Description">
        <Text value={d.description} onChange={set("description")} placeholder="Engine oil filter" />
      </Field>
      <div className="fldRow">
        <Field label="Cost">
          <Num value={d.cost} onChange={set("cost")} />
        </Field>
        <Field label="Sell price">
          <Num value={d.price} onChange={set("price")} />
        </Field>
        <Field label="On hand">
          <Num value={d.onHand} onChange={set("onHand")} />
        </Field>
        <Field label="Reorder at">
          <Num value={d.reorderAt} onChange={set("reorderAt")} />
        </Field>
      </div>
      <div className="fldRow">
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
        <Field label="Bin / location">
          <Text value={d.location} onChange={set("location")} placeholder="Rack B, shelf 2" />
        </Field>
      </div>
      <label className="fld inline">
        <input type="checkbox" checked={d.taxable !== false} onChange={(e) => set("taxable")(e.target.checked)} />
        <span>Taxable</span>
      </label>
      {d.id && (
        <label className="fld inline">
          <input type="checkbox" checked={d.active === false} onChange={(e) => set("active")(!e.target.checked)} />
          <span>Discontinued (hide from pickers, keep history)</span>
        </label>
      )}
      {err && <p className="fldErr">{err}</p>}
      <button className="btn primary lg full" onClick={save}>
        Save part
      </button>
    </Modal>
  );
}
