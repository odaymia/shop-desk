import { useState, useMemo, useEffect, useRef } from "react";
import { Modal, Field, fmtPhone, fmtDate } from "./ui.jsx";
import { VehicleForm } from "./forms.jsx";
import { customerName, vehicleName, activeList, ordersOf } from "./useShop.js";

/* A new ticket: plate → the car → the estimate. No customer questions up
   front; people want a price before they give a name. The customer is
   added from the ticket later. A car on file shows its details to confirm;
   a new plate opens the vehicle form (with the plate lookup when a key is
   set). Walk-ins can skip all of it. */

const US_STATES = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
const norm = (p) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function StartTicket({ shop, cfg, onStart, onClose }) {
  const [plate, setPlate] = useState("");
  const [state, setState] = useState("CA");
  const [step, setStep] = useState("plate"); // plate | confirm | vehicle | edit
  const [chosen, setChosen] = useState(null); // vehicle on file being confirmed
  const inputRef = useRef(null);
  useEffect(() => inputRef.current && inputRef.current.focus(), []);

  const matches = useMemo(() => {
    const p = norm(plate);
    if (p.length < 2) return [];
    return activeList(shop.vehicles)
      .filter((v) => norm(v.plate).startsWith(p))
      .sort((a, b) => (norm(a.plate) === p ? -1 : 0) - (norm(b.plate) === p ? -1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 8)
      .map((v) => {
        const last = ordersOf(shop.orders, { vehicleId: v.id })[0];
        return { v, owner: shop.customers[v.customerId], last };
      });
  }, [shop.vehicles, shop.customers, shop.orders, plate]);

  const exact = matches.find((m) => norm(m.v.plate) === norm(plate));

  const pick = (m) => {
    setChosen(m.v);
    setStep("confirm");
  };
  const start = (v) => onStart({ customerId: v.customerId || null, vehicleId: v.id });

  if (step === "vehicle")
    return (
      <VehicleForm
        cfg={cfg}
        customerId={null}
        initial={{ plate: norm(plate), plateState: state }}
        autoLookup
        onClose={() => setStep("plate")}
        onSave={async (v) => {
          const saved = await shop.saveVehicle(v);
          start(saved);
        }}
      />
    );

  if (step === "edit" && chosen)
    return (
      <VehicleForm
        cfg={cfg}
        customerId={chosen.customerId || null}
        initial={chosen}
        onClose={() => setStep("confirm")}
        onSave={async (v) => {
          const saved = await shop.saveVehicle(v);
          start(saved);
        }}
      />
    );

  if (step === "confirm" && chosen) {
    const owner = shop.customers[chosen.customerId];
    const last = ordersOf(shop.orders, { vehicleId: chosen.id })[0];
    return (
      <Modal title="Is this the car?" onClose={() => setStep("plate")}>
        <div className="whoName" style={{ fontSize: 22 }}>
          {vehicleName(chosen)}
        </div>
        <dl className="kv" style={{ margin: "12px 0 18px" }}>
          <dt>Plate</dt>
          <dd className="num">
            {chosen.plate || "—"}
            {chosen.plateState ? ` (${chosen.plateState})` : ""}
          </dd>
          <dt>VIN</dt>
          <dd className="num">{chosen.vin || "—"}</dd>
          <dt>Engine</dt>
          <dd>{chosen.engine || "—"}</dd>
          <dt>Color</dt>
          <dd>{chosen.color || "—"}</dd>
          <dt>Mileage</dt>
          <dd className="num">{chosen.mileage ? Number(chosen.mileage).toLocaleString() : "—"}</dd>
          <dt>Customer</dt>
          <dd>{owner ? `${customerName(owner)}${owner.phone ? ` · ${fmtPhone(owner.phone)}` : ""}` : "none on file yet"}</dd>
          <dt>Last visit</dt>
          <dd>{last ? fmtDate(last.invoicedAt || last.createdAt) : "—"}</dd>
        </dl>
        <div className="rowBtns">
          <button className="btn primary lg" onClick={() => start(chosen)} autoFocus>
            Yes, start the estimate
          </button>
          <button className="btn lg" onClick={() => setStep("edit")}>
            Fix car details
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="New ticket" onClose={onClose} size="wide">
      <p className="muted" style={{ marginTop: 0 }}>
        Start with the plate.
      </p>
      <div className="fldRow">
        <Field label="Plate">
          <input
            ref={inputRef}
            value={plate}
            onChange={(e) => setPlate(e.target.value.toUpperCase())}
            placeholder="8ABC123"
            style={{ fontSize: 26, letterSpacing: ".08em", fontWeight: 600 }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              if (exact) pick(exact);
              else if (matches.length === 1) pick(matches[0]);
              else if (norm(plate).length >= 2) setStep("vehicle");
            }}
          />
        </Field>
        <Field label="State" className="stateFld">
          <select value={state} onChange={(e) => setState(e.target.value)}>
            {US_STATES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
      </div>

      {matches.length > 0 && (
        <ul className="pickList" style={{ marginTop: 0 }}>
          {matches.map((m) => (
            <li key={m.v.id} onClick={() => pick(m)}>
              <div className="main">
                <strong>
                  {m.v.plate} · {vehicleName(m.v)}
                </strong>
                <span>
                  {customerName(m.owner)}
                  {m.owner && m.owner.phone ? ` · ${fmtPhone(m.owner.phone)}` : ""}
                  {m.last ? ` · last in ${fmtDate(m.last.invoicedAt || m.last.createdAt)}` : " · no visits yet"}
                </span>
              </div>
              <div className="side">{m.v.mileage ? `${Number(m.v.mileage).toLocaleString()} mi` : ""}</div>
            </li>
          ))}
        </ul>
      )}

      <div className="rowBtns" style={{ marginTop: 14 }}>
        <button className="btn primary" disabled={norm(plate).length < 2} onClick={() => setStep("vehicle")}>
          {norm(plate).length >= 2 && !exact ? `New car with plate ${norm(plate)}` : "New car"}
        </button>
        <button className="btn ghost" onClick={() => onStart({})}>
          Skip, walk-in
        </button>
      </div>
      <p className="legalNote">
        A plate on file shows the car to confirm, then opens the estimate. A new plate{" "}
        {cfg.plateApiKey ? "is looked up and the car is built from it" : "opens a blank car to fill in"}. The customer's name
        and number go on the ticket whenever they're ready, from the Customer button at the top.
      </p>
    </Modal>
  );
}
