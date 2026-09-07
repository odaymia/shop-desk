import { useState, useMemo, useEffect, useRef } from "react";
import { Modal, Field, fmtPhone, fmtDate } from "./ui.jsx";
import { CustomerPicker, VehicleForm } from "./forms.jsx";
import { customerName, vehicleName, activeList, ordersOf } from "./useShop.js";

/* A new ticket starts with the plate. Type it, and either the car is on
   file (one tap, the owner comes with it) or it's new and we build the
   vehicle, then find or add the customer. Walk-ins can skip all of it. */

const US_STATES = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
const norm = (p) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function StartTicket({ shop, cfg, onStart, onClose }) {
  const [plate, setPlate] = useState("");
  const [state, setState] = useState("CA");
  const [step, setStep] = useState("plate"); // plate | customer | vehicle
  const [customer, setCustomer] = useState(null);
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

  const pick = (m) => onStart({ customerId: m.v.customerId || null, vehicleId: m.v.id });

  if (step === "customer")
    return (
      <CustomerPicker
        shop={shop}
        onClose={() => setStep("plate")}
        onPick={(c) => {
          setCustomer(c);
          setStep("vehicle");
        }}
      />
    );

  if (step === "vehicle")
    return (
      <VehicleForm
        cfg={cfg}
        customerId={customer.id}
        initial={{ plate: norm(plate), plateState: state }}
        autoLookup
        onClose={() => setStep("plate")}
        onSave={async (v) => {
          const saved = await shop.saveVehicle(v);
          onStart({ customerId: customer.id, vehicleId: saved.id });
        }}
      />
    );

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
              else if (norm(plate).length >= 2) setStep("customer");
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
        <button className="btn primary" disabled={norm(plate).length < 2} onClick={() => setStep("customer")}>
          {norm(plate).length >= 2 && !exact ? `New car with plate ${norm(plate)}` : "New car"}
        </button>
        <button className="btn ghost" onClick={() => onStart({})}>
          Skip, walk-in
        </button>
      </div>
      <p className="legalNote">
        A plate that's on file opens the ticket with the car and its owner already filled in. A new plate asks who the
        customer is, then {cfg.plateApiKey ? "looks the car up from the plate" : "builds the car"}.
      </p>
    </Modal>
  );
}
