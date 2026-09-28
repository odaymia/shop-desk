import { useMemo, useState } from "react";
import { Modal, Money, toNum } from "./ui.jsx";
import { vehicleName, ordersOf } from "./useShop.js";
import { normalizeTireSize, isTireSize, tireName } from "../lib/tires.js";
import { sizeForVehicle, tiresForSize, stockedSizes, tireAddOns, tireQuoteLines, quoteSubtotal, addOnCharge } from "../lib/tireQuote.js";
import { orderTotals, fmtMoney } from "../lib/invoice.js";
import { uid } from "../lib/ids.js";
import { DistributorTires } from "./Tires.jsx";

/* The tire estimate builder: the car's size (or pick one) → the tires in
   stock in that size → how many → add-ons → the estimate, ready for the
   customer to sign. Adds one grouped job to the ticket. */

const STEPS = [
  ["size", "Size"],
  ["tire", "Tire"],
  ["count", "How many"],
  ["addons", "Add-ons"],
  ["review", "Estimate"],
];

export function TireQuote({ shop, cfg, order, customer, vehicle, flash, onClose, onAdd }) {
  const history = useMemo(() => (order.vehicleId ? ordersOf(shop.orders, { vehicleId: order.vehicleId }).filter((o) => o.id !== order.id) : []), [shop.orders, order.vehicleId, order.id]);
  const known = useMemo(() => sizeForVehicle(vehicle, history, shop.parts), [vehicle, history, shop.parts]);
  const [step, setStep] = useState(known.size ? "tire" : "size");
  const [size, setSize] = useState(known.size);
  const [typedSize, setTypedSize] = useState(known.size);
  const [tire, setTire] = useState(null);
  const [typing, setTyping] = useState(false); // a tire that isn't in inventory
  const [typed, setTyped] = useState({ description: "", price: "" });
  const [count, setCount] = useState(4);
  const addOnList = tireAddOns(cfg).filter((a) => String(a.label || "").trim());
  const [picked, setPicked] = useState(() => Object.fromEntries(addOnList.map((a) => [a.id, { on: !!a.on, price: String(a.price ?? "") }])));
  const [saveSize, setSaveSize] = useState(true);
  const [dist, setDist] = useState(false);

  const tires = useMemo(() => tiresForSize(shop.parts, size), [shop.parts, size]);
  const sizes = useMemo(() => stockedSizes(shop.parts), [shop.parts]);
  const chosenAddOns = addOnList.filter((a) => picked[a.id] && picked[a.id].on).map((a) => ({ ...a, price: toNum(picked[a.id].price) }));
  const quote = tire ? tireQuoteLines({ tire, size, count, picked: chosenAddOns, cfg, id: uid }) : { job: "", lines: [] };
  const totals = orderTotals({ ...order, lines: quote.lines, noSupplies: true, payments: [] }, cfg, customer);

  const goSize = (s) => {
    const n = normalizeTireSize(s);
    if (!isTireSize(n)) return flash("That doesn't look like a tire size. Try 225/65R17.", "out");
    setSize(n);
    setTypedSize(n);
    setTire(null);
    setStep("tire");
  };
  const pickTire = (t) => {
    setTire(t);
    setTyping(false);
    setStep("count");
  };
  const add = (sign) => {
    onAdd(quote.lines, { size: saveSize ? size : "", sign });
  };

  const stepIdx = STEPS.findIndex(([k]) => k === step);
  const canGo = (k) => {
    if (k === "size") return true;
    if (k === "tire") return !!size;
    return !!tire;
  };

  return (
    <Modal title={`Tire quote${vehicle ? ` · ${vehicleName(vehicle)}` : ""}`} onClose={onClose} size="xwide">
      <div className="tqSteps">
        {STEPS.map(([k, label], i) => (
          <button key={k} type="button" className={`tqStep ${k === step ? "on" : ""} ${i < stepIdx ? "done" : ""}`} disabled={!canGo(k)} onClick={() => setStep(k)}>
            <span>{i + 1}</span>
            {label}
            {k === "size" && size ? <em>{size}</em> : null}
            {k === "tire" && tire ? <em>{tire.tire ? tireName(tire) : tire.description}</em> : null}
            {k === "count" && tire ? <em>× {count}</em> : null}
          </button>
        ))}
      </div>

      {step === "size" && (
        <div className="tqBody">
          {known.size ? (
            <button type="button" className="tqKnown" onClick={() => goSize(known.size)}>
              <strong>{known.size}</strong>
              <span>{known.from === "car" ? "Saved on this car" : "What this car got last time"}</span>
            </button>
          ) : (
            <p className="muted" style={{ marginTop: 0 }}>
              {vehicle ? "No tire size on file for this car yet. Read it off the sidewall or the door jamb sticker." : "No car on the ticket. Type the size from the sidewall."}
            </p>
          )}
          <div className="rowBtns" style={{ margin: "12px 0" }}>
            <input
              className="search tqSize"
              value={typedSize}
              onChange={(e) => setTypedSize(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && goSize(typedSize)}
              placeholder="225/65R17"
              autoFocus
            />
            <button className="btn primary" onClick={() => goSize(typedSize)} disabled={!typedSize.trim()}>
              Find tires
            </button>
          </div>
          {sizes.length > 0 && (
            <>
              <div className="fld">
                <span>Sizes on the rack</span>
              </div>
              <div className="chipRow">
                {sizes.map((s) => (
                  <button key={s.size} type="button" className={`payChip ${s.size === size ? "on" : ""}`} onClick={() => goSize(s.size)}>
                    {s.size} <span className="muted">({s.onHand})</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {step === "tire" && (
        <div className="tqBody">
          <div className="rowBtns" style={{ marginBottom: 10 }}>
            <strong style={{ fontSize: 18 }}>{size}</strong>
            <button className="btn tiny ghost" onClick={() => setStep("size")}>
              Different size
            </button>
            <div className="grow" />
            <button className="btn tiny" onClick={() => setDist(true)}>
              Search US AutoForce
            </button>
            <button className="btn tiny" onClick={() => setTyping(true)}>
              Type a tire we'll order
            </button>
          </div>
          {typing && (
            <div className="tqTyped">
              <input className="search" style={{ flex: 2 }} value={typed.description} onChange={(e) => setTyped({ ...typed, description: e.target.value })} placeholder="Brand and model, e.g. Toyo Open Country A/T III" autoFocus />
              <input className="search" style={{ flex: 1, minWidth: 0 }} value={typed.price} onChange={(e) => setTyped({ ...typed, price: e.target.value })} placeholder="Price each" inputMode="decimal" />
              <button className="btn primary" disabled={!typed.description.trim() || !(toNum(typed.price) > 0)} onClick={() => pickTire({ description: typed.description.trim(), price: toNum(typed.price), size })}>
                Use this tire
              </button>
            </div>
          )}
          {tires.length === 0 ? (
            <p className="emptyNote">No {size} tires in inventory. Search US AutoForce to add one, or type the tire you'll order.</p>
          ) : (
            <div className="tqTires">
              {tires.map((p) => {
                const stock = toNum(p.onHand);
                return (
                  <button key={p.id} type="button" className={`tqTire ${tire && tire.id === p.id ? "on" : ""}`} onClick={() => pickTire(p)}>
                    <span className="tqBrand">{tireName(p)}</span>
                    <span className="muted">
                      {[p.size, p.loadSpeed, p.number].filter(Boolean).join(" · ")}
                    </span>
                    <span className="tqPrice">
                      <Money v={p.price} /> <small>each</small>
                    </span>
                    <span className={`tqStock ${stock >= 4 ? "ok" : stock > 0 ? "low" : "out"}`}>{stock > 0 ? `${stock} on hand` : "Order in"}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {step === "count" && tire && (
        <div className="tqBody">
          <p style={{ marginTop: 0 }}>
            <strong>{tire.tire ? tireName(tire) : tire.description}</strong> {size} · <Money v={tire.price} /> each
          </p>
          <div className="countRow">
            {[1, 2, 3, 4].map((n) => (
              <button key={n} className={`btn lg ${count === n ? "primary" : ""}`} onClick={() => setCount(n)}>
                {n}
              </button>
            ))}
            <input className="search" style={{ minWidth: 0, width: 90 }} inputMode="numeric" value={count} onChange={(e) => setCount(Math.max(1, Math.round(toNum(e.target.value)) || 1))} />
          </div>
          {tire.tire && toNum(tire.onHand) < count && (
            <p className="fldErr">Only {toNum(tire.onHand)} on hand. The rest will need to be ordered in.</p>
          )}
          <p className="muted">
            {count} × <Money v={tire.price} /> = <strong>{fmtMoney(count * toNum(tire.price))}</strong>
          </p>
          <button className="btn primary lg" onClick={() => setStep("addons")}>
            Next: add-ons
          </button>
        </div>
      )}

      {step === "addons" && tire && (
        <div className="tqBody">
          <div className="tqAddOns">
            {addOnList.map((a) => {
              const st = picked[a.id] || { on: false, price: "" };
              const pct = a.mode === "percent";
              const ch = addOnCharge({ ...a, price: toNum(st.price) }, tire, count);
              const info = a.details || a.note;
              return (
                <label key={a.id} className={`tqAddOn ${st.on ? "on" : ""}`}>
                  <input type="checkbox" checked={st.on} onChange={(e) => setPicked((m) => ({ ...m, [a.id]: { ...st, on: e.target.checked } }))} />
                  <span className="tqAddLabel">
                    <strong>{a.label}</strong>
                    {pct ? (
                      <span className="muted">
                        {fmtMoney(ch.price)} {a.per === "ticket" ? "for the set" : "a tire"} ({toNum(st.price)}% of {a.per === "ticket" ? "the tires" : fmtMoney(tire.price)})
                      </span>
                    ) : null}
                    {info ? <span className="muted tqAddInfo">{info}</span> : null}
                  </span>
                  <span className="tqAddPrice" onClick={(e) => e.preventDefault()}>
                    {pct ? "" : "$"}
                    <input value={st.price} onChange={(e) => setPicked((m) => ({ ...m, [a.id]: { ...st, price: e.target.value } }))} inputMode="decimal" />
                    <small>{pct ? `% ${a.per === "ticket" ? "once" : "per tire"}` : a.per === "ticket" ? "once" : "per tire"}</small>
                  </span>
                  <span className="tqAddTotal">{st.on ? fmtMoney(ch.qty * ch.price) : ""}</span>
                </label>
              );
            })}
          </div>
          <div className="rowBtns" style={{ marginTop: 14 }}>
            <button className="btn primary lg" onClick={() => setStep("review")}>
              Next: the estimate · {fmtMoney(quoteSubtotal(quote.lines))}
            </button>
          </div>
        </div>
      )}

      {step === "review" && tire && (
        <div className="tqBody">
          <table className="dk tqReview">
            <tbody>
              {quote.lines.map((l) => {
                const qty = l.kind === "labor" ? l.hours : l.qty;
                const each = l.kind === "labor" ? l.rate : l.price;
                return (
                  <tr key={l.id}>
                    <td>
                      {l.description}
                      {l.details ? <div className="muted tqAddInfo">{l.details}</div> : null}
                    </td>
                    <td className="r num">{qty}</td>
                    <td className="r num">
                      <Money v={each} />
                    </td>
                    <td className="r num">
                      <Money v={toNum(qty) * toNum(each)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="tqTotals">
            <div>
              <span>Subtotal</span>
              <Money v={totals.subtotal} />
            </div>
            <div>
              <span>Sales tax{totals.taxRate ? ` (${totals.taxRate}%)` : ""}</span>
              <Money v={totals.tax} />
            </div>
            <div className="grand">
              <span>Estimate total</span>
              <Money v={totals.total} />
            </div>
          </div>
          {vehicle && normalizeTireSize(vehicle.tireSize) !== size && (
            <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "12px 0" }}>
              <input type="checkbox" checked={saveSize} onChange={(e) => setSaveSize(e.target.checked)} />
              <span>Save {size} as this car's tire size</span>
            </label>
          )}
          <div className="rowBtns" style={{ marginTop: 12 }}>
            <button className="btn primary lg" onClick={() => add(true)}>
              Add to estimate & have the customer sign
            </button>
            <button className="btn lg" onClick={() => add(false)}>
              Just add to the estimate
            </button>
          </div>
          <p className="legalNote">Shop supplies, if you charge them, are added on the ticket. The customer signs the full estimate.</p>
        </div>
      )}

      {dist && <DistributorTires shop={shop} cfg={cfg} flash={flash} initialSize={size} onClose={() => setDist(false)} />}
    </Modal>
  );
}
