import { useState, useMemo } from "react";
import { Modal, Field, Text, Num, Money, toNum } from "./ui.jsx";
import { activeList, searchText } from "./useShop.js";
import { OIL_TYPE_OPTIONS } from "../lib/oilchange.js";
import { itemCategory, packQuartsOf } from "../lib/inventoryReports.js";

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
  oilType: "", // for motor oils: conventional | blend | synthetic | diesel | euro
  packType: "", // how it's bought, for reordering: "" (each) | case | box | bulk. Sold by the quart regardless.
  packSize: "", // case=quarts, box=gallons, bulk=minimum gallons
  surcharge: "", // extra charge added on top of an oil-change package when this part is used
  surchargeLabel: "",
  active: true,
});

const PACK_LABEL = { case: "Quarts per case", box: "Gallons per box", bulk: "Minimum gallons" };
const PACK_PLACEHOLDER = { case: "6", box: "5", bulk: "110" };
const PART_CATS = ["Oil", "Oil Filters", "Engine Air Filters", "Cabin Air Filters", "Brake Pads", "Brake Rotors", "Wipers", "Fluids", "Belts", "Batteries", "Tires", "Parts"];

export function Inventory({ shop, flash }) {
  const [q, setQ] = useState("");
  const [only, setOnly] = useState("all"); // all | low
  const [cat, setCat] = useState("all");
  const [edit, setEdit] = useState(null);
  const [quick, setQuick] = useState(false);
  const [receive, setReceive] = useState(false);
  const vendors = activeList(shop.vendors).sort((a, b) => a.name.localeCompare(b.name));

  const stock = useMemo(
    () => activeList(shop.parts).filter((p) => !p.tire).map((p) => ({ p, cat: itemCategory(p) })),
    [shop.parts]
  );
  const cats = useMemo(() => [...new Set(stock.map((x) => x.cat).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [stock]);
  const rows = useMemo(
    () =>
      stock
        .filter((x) => cat === "all" || x.cat === cat)
        .filter(({ p }) => searchText(q, p.number, p.description, p.category, p.location, (shop.vendors[p.vendorId] || {}).name))
        .filter(({ p }) => only === "all" || toNum(p.onHand) <= toNum(p.reorderAt))
        .map((x) => x.p)
        .sort((a, b) => itemCategory(a).localeCompare(itemCategory(b)) || (a.number || "").localeCompare(b.number || "")),
    [stock, shop.vendors, q, only, cat]
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
        <button className="btn" onClick={() => setReceive(true)}>
          Receive order
        </button>
        <button className="btn" onClick={() => setQuick(true)}>
          Quick add
        </button>
        <button className="btn primary" onClick={() => setEdit(blank())}>
          Add part
        </button>
      </header>
      {quick && <QuickAdd shop={shop} flash={flash} onClose={() => setQuick(false)} />}
      {receive && <ReceiveOrder shop={shop} flash={flash} onClose={() => setReceive(false)} />}
      <div className="deskBody">
        {cats.length > 1 && (
          <div className="catBar" style={{ paddingBottom: 14 }}>
            <button className={`btn tiny ${cat === "all" ? "primary" : ""}`} onClick={() => setCat("all")}>
              All
            </button>
            {cats.map((c) => (
              <button key={c} className={`btn tiny ${cat === c ? "primary" : ""}`} onClick={() => setCat(c)}>
                {c}
              </button>
            ))}
          </div>
        )}
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
                    <td className="muted">{itemCategory(p)}</td>
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
      packType: d.packType || "",
      packSize: d.packType ? toNum(d.packSize) : "",
      surcharge: toNum(d.surcharge),
      surchargeLabel: (d.surchargeLabel || "").trim(),
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
        <Field label="Oil type (for motor oils)">
          <select value={d.oilType || ""} onChange={(e) => set("oilType")(e.target.value)}>
            <option value="">—</option>
            {OIL_TYPE_OPTIONS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <datalist id="partCats">
        {PART_CATS.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
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
      <div className="fldRow">
        <Field label="Bought as (for reordering)">
          <select value={d.packType || ""} onChange={(e) => set("packType")(e.target.value)}>
            <option value="">Each — sold and bought by the unit</option>
            <option value="case">Quart case</option>
            <option value="box">Gallon box</option>
            <option value="bulk">Bulk — minimum order</option>
          </select>
        </Field>
        {d.packType ? (
          <Field label={PACK_LABEL[d.packType]}>
            <Num value={d.packSize} onChange={set("packSize")} placeholder={PACK_PLACEHOLDER[d.packType]} />
          </Field>
        ) : (
          <div className="fld" />
        )}
      </div>
      {d.packType && (
        <p className="legalNote" style={{ marginTop: -6 }}>
          The reorder planner suggests orders in whole {d.packType === "case" ? "cases" : d.packType === "box" ? "boxes" : "bulk gallons"}. Oil is still counted and sold by the quart.
        </p>
      )}
      <div className="fldRow">
        <Field label="Oil-change surcharge">
          <Num value={d.surcharge} onChange={set("surcharge")} placeholder="0.00" />
        </Field>
        <Field label="Charge shows as">
          <Text value={d.surchargeLabel} onChange={set("surchargeLabel")} placeholder="Canister filter charge / Bottled oil surcharge" />
        </Field>
      </div>
      <p className="legalNote" style={{ marginTop: -6 }}>
        An extra charge added on top of the oil-change package when this oil or filter is used — for canister and
        cartridge filters, or bottled and boxed oils, that cost more than bulk. Leave the amount blank for none.
      </p>
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

/* Quick add: a grid to type many parts fast, or paste rows from a
   spreadsheet or the distributor invoice. A new blank row appears as you
   fill the last one. New rows inherit the default category you set, so a
   run of the same kind (20 oil filters) is just number + description. */
const emptyRow = (category = "") => ({ number: "", description: "", category, cost: "", price: "", onHand: "" });
const rowHasData = (r) => (r.number || "").trim() || (r.description || "").trim();

function QuickAdd({ shop, flash, onClose }) {
  const [defCat, setDefCat] = useState("");
  const [rows, setRows] = useState([emptyRow()]);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);

  const setCell = (i, field, val) =>
    setRows((rs) => {
      const next = rs.map((r, k) => (k === i ? { ...r, [field]: val } : r));
      if (rowHasData(next[next.length - 1])) next.push(emptyRow(defCat));
      return next;
    });

  const addPaste = () => {
    const parsed = paste
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const c = line.split(/\t|,/).map((s) => s.trim());
        return { number: c[0] || "", description: c[1] || "", category: c[2] || defCat, cost: c[3] || "", price: c[4] || "", onHand: c[5] || "" };
      });
    if (!parsed.length) return;
    setRows((rs) => [...rs.filter(rowHasData), ...parsed, emptyRow(defCat)]);
    setPaste("");
  };

  const filled = rows.filter(rowHasData);
  const save = async () => {
    if (!filled.length) return;
    setBusy(true);
    for (const r of filled) {
      await shop.savePart({
        ...blank(),
        number: (r.number || "").trim().toUpperCase(),
        description: (r.description || "").trim(),
        category: (r.category || "").trim(),
        cost: toNum(r.cost),
        price: toNum(r.price),
        onHand: toNum(r.onHand),
      });
    }
    flash(`${filled.length} part${filled.length === 1 ? "" : "s"} added`);
    onClose();
  };

  return (
    <Modal title="Quick add parts" onClose={onClose} size="xwide">
      <datalist id="partCats">
        {PART_CATS.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <div className="fldRow" style={{ alignItems: "flex-end" }}>
        <Field label="New rows default to this category">
          <Text value={defCat} onChange={setDefCat} placeholder="e.g. Oil Filters" list="partCats" />
        </Field>
        <p className="legalNote" style={{ margin: 0, flex: 2 }}>
          Type down the grid — Tab moves across, a new row appears as you fill the last one. Or paste rows below.
        </p>
      </div>

      <div className="qaScroll">
        <table className="lines qaGrid">
          <thead>
            <tr>
              <th style={{ width: 130 }}>Part #</th>
              <th>Description</th>
              <th style={{ width: 150 }}>Category</th>
              <th style={{ width: 80 }}>Cost</th>
              <th style={{ width: 80 }}>Price</th>
              <th style={{ width: 70 }}>On hand</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  <input value={r.number} onChange={(e) => setCell(i, "number", e.target.value.toUpperCase())} />
                </td>
                <td>
                  <input value={r.description} onChange={(e) => setCell(i, "description", e.target.value)} />
                </td>
                <td>
                  <input value={r.category} onChange={(e) => setCell(i, "category", e.target.value)} list="partCats" />
                </td>
                <td>
                  <input inputMode="decimal" value={r.cost} onChange={(e) => setCell(i, "cost", e.target.value.replace(/[^0-9.]/g, ""))} />
                </td>
                <td>
                  <input inputMode="decimal" value={r.price} onChange={(e) => setCell(i, "price", e.target.value.replace(/[^0-9.]/g, ""))} />
                </td>
                <td>
                  <input inputMode="numeric" value={r.onHand} onChange={(e) => setCell(i, "onHand", e.target.value.replace(/[^0-9.]/g, ""))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details style={{ marginTop: 12 }}>
        <summary className="muted" style={{ cursor: "pointer" }}>Paste from a spreadsheet or invoice</summary>
        <p className="legalNote" style={{ marginTop: 6 }}>
          One part per line: part number, description, category, cost, price, on hand — separated by tabs (paste from
          Excel) or commas. Category, cost, price, and on hand are optional.
        </p>
        <textarea className="ta" style={{ minHeight: 90 }} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"VO106\tValvoline oil filter\tOil Filters\t2.10\t6.99\t24"} />
        <button className="btn" style={{ marginTop: 8 }} onClick={addPaste} disabled={!paste.trim()}>
          Add pasted rows to the grid
        </button>
      </details>

      <div className="rowBtns" style={{ marginTop: 16 }}>
        <button className="btn primary lg" onClick={save} disabled={busy || !filled.length}>
          {busy ? "Adding…" : `Add ${filled.length} part${filled.length === 1 ? "" : "s"}`}
        </button>
        <button className="btn lg" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/* Receive order: bump the on-hand of existing parts after a shipment
   arrives. Type or paste part numbers and how many came in; oils bought
   in cases/boxes/bulk take the pack count and convert to quarts. Cost can
   be updated if it changed. Nothing is created — unmatched numbers are
   flagged so you can add them first. */
const RECV_UNIT = { case: "cases", box: "boxes", bulk: "gallons" };
function receivedUnits(part, entered) {
  const n = toNum(entered);
  if (!part || !part.packType) return n;
  if (part.packType === "case" || part.packType === "box") return n * (packQuartsOf(part) || 1);
  if (part.packType === "bulk") return n * 4; // gallons → quarts
  return n;
}
const recvRow = () => ({ number: "", entered: "", cost: "" });
const recvHasData = (r) => (r.number || "").trim();

function ReceiveOrder({ shop, flash, onClose }) {
  const [rows, setRows] = useState([recvRow()]);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const byNumber = useMemo(() => {
    const m = {};
    for (const p of Object.values(shop.parts)) if (p.active !== false && p.number) m[String(p.number).trim().toUpperCase()] = p;
    return m;
  }, [shop.parts]);
  const partFor = (num) => byNumber[String(num || "").trim().toUpperCase()] || null;

  const setCell = (i, field, val) =>
    setRows((rs) => {
      const next = rs.map((r, k) => (k === i ? { ...r, [field]: val } : r));
      if (recvHasData(next[next.length - 1])) next.push(recvRow());
      return next;
    });
  const addPaste = () => {
    const parsed = paste
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const c = line.split(/\t|,/).map((s) => s.trim());
        return { number: c[0] || "", entered: c[1] || "", cost: c[2] || "" };
      });
    if (!parsed.length) return;
    setRows((rs) => [...rs.filter(recvHasData), ...parsed, recvRow()]);
    setPaste("");
  };

  const filled = rows.filter(recvHasData);
  const matched = filled.filter((r) => partFor(r.number) && toNum(r.entered) > 0);
  const missing = filled.filter((r) => !partFor(r.number));
  const save = async () => {
    if (!matched.length) return;
    setBusy(true);
    for (const r of matched) {
      const part = partFor(r.number);
      const added = receivedUnits(part, r.entered);
      await shop.savePart({
        ...part,
        onHand: toNum(part.onHand) + added,
        cost: (r.cost || "").trim() ? toNum(r.cost) : part.cost,
      });
    }
    flash(`Received into ${matched.length} part${matched.length === 1 ? "" : "s"}`);
    onClose();
  };

  return (
    <Modal title="Receive an order" onClose={onClose} size="xwide">
      <p className="legalNote" style={{ marginTop: 0 }}>
        Enter each part number and how many came in — it adds to what's on hand. Oils bought in cases, boxes, or bulk
        take the pack count and convert to quarts. Update the cost only if it changed.
      </p>
      <div className="qaScroll">
        <table className="lines qaGrid">
          <thead>
            <tr>
              <th style={{ width: 140 }}>Part #</th>
              <th>Item</th>
              <th className="r" style={{ width: 90 }}>On hand</th>
              <th style={{ width: 150 }}>Received</th>
              <th className="r" style={{ width: 100 }}>New on hand</th>
              <th style={{ width: 90 }}>New cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const part = partFor(r.number);
              const unit = part && part.packType ? RECV_UNIT[part.packType] : "";
              const added = receivedUnits(part, r.entered);
              const notFound = recvHasData(r) && !part;
              return (
                <tr key={i}>
                  <td>
                    <input value={r.number} onChange={(e) => setCell(i, "number", e.target.value.toUpperCase())} />
                  </td>
                  <td className={notFound ? "" : "muted"}>
                    {part ? (
                      <>
                        {part.description}
                        {itemCategory(part) ? <span className="sub">{itemCategory(part)}</span> : null}
                      </>
                    ) : notFound ? (
                      <span style={{ color: "var(--warn)" }}>Not in inventory — add it first</span>
                    ) : (
                      ""
                    )}
                  </td>
                  <td className="r num muted">{part ? toNum(part.onHand) : "—"}</td>
                  <td>
                    <span className="rcvIn">
                      <input inputMode="decimal" value={r.entered} onChange={(e) => setCell(i, "entered", e.target.value.replace(/[^0-9.]/g, ""))} />
                      {unit ? <span className="muted">{unit}</span> : null}
                    </span>
                  </td>
                  <td className="r num">
                    {part && toNum(r.entered) > 0 ? (
                      <strong style={{ color: "var(--live)" }}>{toNum(part.onHand) + added}</strong>
                    ) : (
                      "—"
                    )}
                    {unit && toNum(r.entered) > 0 ? <span className="sub">+{added} qt</span> : null}
                  </td>
                  <td>
                    <input inputMode="decimal" value={r.cost} onChange={(e) => setCell(i, "cost", e.target.value.replace(/[^0-9.]/g, ""))} placeholder={part ? String(toNum(part.cost)) : ""} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <details style={{ marginTop: 12 }}>
        <summary className="muted" style={{ cursor: "pointer" }}>Paste from a packing list</summary>
        <p className="legalNote" style={{ marginTop: 6 }}>
          One part per line: part number, quantity received, new cost — tabs or commas. Quantity is packs for
          case/box/bulk oils, units otherwise. Cost is optional.
        </p>
        <textarea className="ta" style={{ minHeight: 80 }} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"VO106\t24\nVS5/30\t10"} />
        <button className="btn" style={{ marginTop: 8 }} onClick={addPaste} disabled={!paste.trim()}>
          Add pasted rows to the grid
        </button>
      </details>

      {missing.length > 0 && (
        <p className="fldErr" style={{ marginTop: 12 }}>
          {missing.length} number{missing.length === 1 ? "" : "s"} not in inventory — add {missing.length === 1 ? "it" : "them"} with Quick add first, or fix the number.
        </p>
      )}
      <div className="rowBtns" style={{ marginTop: 12 }}>
        <button className="btn primary lg" onClick={save} disabled={busy || !matched.length}>
          {busy ? "Receiving…" : `Receive into ${matched.length} part${matched.length === 1 ? "" : "s"}`}
        </button>
        <button className="btn lg" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
