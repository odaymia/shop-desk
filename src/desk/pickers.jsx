import { useState, useMemo } from "react";
import { Modal, Money, toNum } from "./ui.jsx";
import { activeList, searchText } from "./useShop.js";
import { jobLines, orderTotals } from "../lib/invoice.js";
import { uid } from "../lib/ids.js";

/* Pick a part from inventory, or type one in. */
export function PartPicker({ shop, onPick, onTyped, onClose }) {
  const [q, setQ] = useState("");
  const rows = useMemo(
    () =>
      activeList(shop.parts)
        .filter((p) => searchText(q, p.number, p.description, p.category))
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
                  {p.number} {p.description ? `— ${p.description}` : ""}
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

/* Pick a canned job. Shows what it would cost at today's prices. */
export function JobPicker({ shop, cfg, onPick, onClose }) {
  const [q, setQ] = useState("");
  const rows = useMemo(
    () =>
      activeList(shop.jobs)
        .filter((j) => searchText(q, j.name, j.category))
        .sort((a, b) => (a.category || "").localeCompare(b.category || "") || a.name.localeCompare(b.name)),
    [shop.jobs, q]
  );
  return (
    <Modal title="Add a job" onClose={onClose} size="wide">
      <input className="search" style={{ width: "100%" }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Job name" autoFocus />
      <ul className="pickList">
        {rows.length === 0 && <li className="emptyNote">{q ? "No job matches." : "No canned jobs yet. Build them under Canned jobs."}</li>}
        {rows.map((j) => {
          const price = orderTotals({ lines: jobLines(j, cfg, shop.parts, uid), noSupplies: true }, cfg).subtotal;
          return (
            <li key={j.id} onClick={() => onPick(j)}>
              <div className="main">
                <strong>{j.name}</strong>
                <span>
                  {j.lines
                    .map((l) => (l.kind === "labor" ? `${l.hours} hr labor` : `${l.qty}× ${l.description || l.number || shop.parts[l.partId]?.description || "part"}`))
                    .join(", ")}
                </span>
              </div>
              <div className="side">
                <strong>
                  <Money v={price} />
                </strong>
                {j.category}
              </div>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
