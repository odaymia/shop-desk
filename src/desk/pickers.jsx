import { useState, useMemo } from "react";
import { Modal, Money, toNum } from "./ui.jsx";
import { activeList, searchText } from "./useShop.js";
import { tireName, tireSizeKey } from "../lib/tires.js";
import { jobLines, orderTotals } from "../lib/invoice.js";
import { uid } from "../lib/ids.js";

/* Pick a part from inventory, or type one in. */
export function PartPicker({ shop, onPick, onTyped, onClose }) {
  const [q, setQ] = useState("");
  const rows = useMemo(
    () =>
      activeList(shop.parts)
        .filter((p) => searchText(q, p.number, p.description, p.size, p.category))
        .sort((a, b) => (a.number || "").localeCompare(b.number || ""))
        .slice(0, 80),
    [shop.parts, q]
  );
  return (
    <Modal title="Add a part" onClose={onClose} size="wide">
      <div className="rowBtns">
        <input
          className="search"
          style={{ flex: 1 }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Part number or description"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && rows.length === 1) onPick(rows[0]);
          }}
        />
        {onTyped && (
          <button className="btn" onClick={() => onTyped(q.trim())}>
            Type it in
          </button>
        )}
      </div>
      <ul className="pickList">
        {rows.length === 0 && (
          <li className="emptyNote">
            {q ? "Not in inventory." : "Nothing stocked yet."} {onTyped ? "Use “Type it in” for a part you're buying for this job." : ""}
          </li>
        )}
        {rows.map((p) => {
          const low = toNum(p.onHand) <= 0;
          return (
            <li key={p.id} className={low ? "low" : ""} onClick={() => onPick(p)}>
              <div className="main">
                <strong>
                  {p.tire ? `${p.size} · ${tireName(p)}` : `${p.number} ${p.description ? `— ${p.description}` : ""}`}
                </strong>
                <span>{[p.category, p.location, (shop.vendors[p.vendorId] || {}).name].filter(Boolean).join(" · ")}</span>
              </div>
              <div className="side">
                <strong>{toNum(p.onHand)} on hand</strong>
                <Money v={p.price} />
              </div>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

/* Pick a canned job. Shows what it would cost at today's prices. A job
   priced per unit asks how many first. */
export function JobPicker({ shop, cfg, onPick, onClose, lastTireSize }) {
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState(null); // job waiting for a count
  const [count, setCount] = useState(4);
  const [pickingTire, setPickingTire] = useState(false);
  const rows = useMemo(
    () =>
      activeList(shop.jobs)
        .filter((j) => searchText(q, j.name, j.category))
        .sort((a, b) => (a.category || "").localeCompare(b.category || "") || a.name.localeCompare(b.name)),
    [shop.jobs, q]
  );
  const lineText = (l, unit) =>
    l.kind === "labor"
      ? unit && l.perUnit
        ? `${l.description || "labor"} $${toNum(l.rate).toFixed(2)}/${unit}`
        : `${l.hours} hr labor`
      : `${l.qty}× ${l.description || l.number || shop.parts[l.partId]?.description || l.kind}${
          l.kind === "fee" ? ` $${toNum(l.price).toFixed(2)}` : ""
        }`;

  if (asking && pickingTire)
    return (
      <TirePicker
        shop={shop}
        count={count}
        startSize={lastTireSize}
        onClose={() => setPickingTire(false)}
        onPick={(tire) => onPick(asking, count, tire)}
        onSkip={() => onPick(asking, count, null)}
      />
    );

  if (asking) {
    const unit = asking.unit;
    const price = orderTotals({ lines: jobLines(asking, cfg, shop.parts, uid, count), noSupplies: true }, cfg).subtotal;
    return (
      <Modal title={asking.name} onClose={() => setAsking(null)}>
        <p className="muted" style={{ marginTop: 0 }}>
          How many {unit}s?
        </p>
        <div className="countRow">
          {[1, 2, 4].map((n) => (
            <button key={n} className={`btn ${count === n ? "primary" : ""}`} onClick={() => setCount(n)}>
              {n}
            </button>
          ))}
          <input
            className="search"
            style={{ minWidth: 0, width: 90 }}
            inputMode="numeric"
            value={count}
            onChange={(e) => setCount(Math.max(1, toNum(e.target.value) || 1))}
          />
        </div>
        <p className="muted">
          {asking.lines
            .map((l) =>
              l.perUnit
                ? l.kind === "labor"
                  ? `${count} × ${l.description || "labor"} at $${toNum(l.rate).toFixed(2)}`
                  : `${toNum(l.qty) * count}× ${l.description || l.number || shop.parts[l.partId]?.description || l.kind}${
                      l.kind === "fee" ? ` at $${toNum(l.price).toFixed(2)}` : ""
                    }`
                : lineText(l, unit)
            )
            .join(", ")}
        </p>
        <button className="btn primary lg full" onClick={() => (unit === "tire" ? setPickingTire(true) : onPick(asking, count))}>
          {unit === "tire" ? `Next: pick the ${count === 1 ? "tire" : "tires"}` : `Add ${count} ${unit}${count === 1 ? "" : "s"}`} · <Money v={price} />
          {unit === "tire" ? " plus tires" : ""}
        </button>
      </Modal>
    );
  }

  return (
    <Modal title="Add a job" onClose={onClose} size="wide">
      <input className="search" style={{ width: "100%" }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Job name" autoFocus />
      <ul className="pickList">
        {rows.length === 0 && <li className="emptyNote">{q ? "No job matches." : "No canned jobs yet. Build them under Canned jobs."}</li>}
        {rows.map((j) => {
          const price = orderTotals({ lines: jobLines(j, cfg, shop.parts, uid), noSupplies: true }, cfg).subtotal;
          return (
            <li key={j.id} onClick={() => (j.unit ? (setAsking(j), setCount(4)) : onPick(j, 1))}>
              <div className="main">
                <strong>{j.name}</strong>
                <span>
                  {j.unit ? `Per ${j.unit}: ` : ""}
                  {j.lines.map((l) => lineText(l, j.unit)).join(", ")}
                </span>
              </div>
              <div className="side">
                <strong>
                  <Money v={price} />
                </strong>
                {j.unit ? `per ${j.unit}` : j.category}
              </div>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}


/* The tire rack, sorted by size. Tap a tire and it goes on the ticket
   with the count already applied. */
export function TirePicker({ shop, count, startSize, onPick, onSkip, onClose }) {
  const [q, setQ] = useState(startSize || "");
  const rows = useMemo(
    () =>
      activeList(shop.parts)
        .filter((p) => p.tire)
        .filter((p) => searchText(q, p.size, tireName(p), p.number))
        .sort((a, b) => {
          const x = tireSizeKey(a.size), y = tireSizeKey(b.size);
          return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || (toNum(b.onHand) > 0) - (toNum(a.onHand) > 0) || tireName(a).localeCompare(tireName(b));
        })
        .slice(0, 120),
    [shop.parts, q]
  );
  return (
    <Modal title={`Which ${count === 1 ? "tire" : "tires"}?`} onClose={onClose} size="wide">
      <div className="rowBtns">
        <input
          className="search"
          style={{ flex: 1 }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Size (225/65R17), brand, model"
          autoFocus
        />
        <button className="btn" onClick={onSkip} title="Labor and fees only — customer-supplied tires, or you'll add the tire line yourself">
          No tire from inventory
        </button>
      </div>
      {startSize && q === startSize && <p className="muted" style={{ margin: "8px 0 0" }}>Showing {startSize}, the size this car got last time. Clear the box to see everything.</p>}
      <ul className="pickList">
        {rows.length === 0 && <li className="emptyNote">{q ? "No tires match that." : "No tires in inventory yet. Add them under Tires."}</li>}
        {rows.map((p) => {
          const short = toNum(p.onHand) < count;
          return (
            <li key={p.id} className={short ? "low" : ""} onClick={() => onPick(p)}>
              <div className="main">
                <strong>
                  {p.size} · {tireName(p)}
                  {p.loadSpeed ? <span className="muted"> {p.loadSpeed}</span> : null}
                </strong>
                <span>{[p.number, (shop.vendors[p.vendorId] || {}).name, p.location].filter(Boolean).join(" · ")}</span>
              </div>
              <div className="side">
                <strong>{toNum(p.onHand)} on hand</strong>
                <Money v={p.price} /> each
              </div>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
