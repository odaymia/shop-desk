import { useState, useMemo, useEffect, useRef } from "react";
import { Modal, Field, fmtPhone, fmtDate } from "./ui.jsx";
import { VehicleForm, CustomerForm } from "./forms.jsx";
import { customerName, vehicleName, activeList, ordersOf, vehiclesOf } from "./useShop.js";

/* A new ticket: plate → the car → the estimate. No customer questions up
   front; people want a price before they give a name. The customer is
   added from the ticket later. A car on file shows its details to confirm;
   a new plate opens the vehicle form (with the plate lookup when a key is
   set). Walk-ins can skip all of it.

   Or by name: find the customer by name, company, or phone, then pick one
   of their cars (or add one). */

const US_STATES = "AL AK AZ AR CA CO CT DC DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
const norm = (p) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const digits = (s) => String(s || "").replace(/\D/g, "");
const MODE_KEY = "sd:startBy";
const savedMode = () => {
  try {
    return localStorage.getItem(MODE_KEY) === "name" ? "name" : "plate";
  } catch {
    return "plate";
  }
};

export function StartTicket({ shop, cfg, onStart, onClose, title = "New ticket", startsAs = "estimate" }) {
  const [plate, setPlate] = useState("");
  const [state, setState] = useState("CA");
  const [step, setStep] = useState("plate"); // plate | confirm | vehicle | edit | newCustomer | carFor
  const [chosen, setChosen] = useState(null); // vehicle on file being confirmed
  const [mode, setModeState] = useState(savedMode); // plate | name
  const [q, setQ] = useState(""); // name, company, or phone
  const [owner, setOwner] = useState(null); // customer a new car is being added for
  const inputRef = useRef(null);
  useEffect(() => inputRef.current && inputRef.current.focus(), [mode]);
  const setMode = (m) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* the choice just isn't remembered */
    }
  };

  /* customers by name, company, or phone (any format), with their cars */
  const people = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (mode !== "name" || needle.length < 2) return [];
    const words = needle.split(/\s+/);
    const qd = digits(needle);
    const phoneish = qd.length >= 3 && qd.length >= needle.replace(/[\s()+.-]/g, "").length;
    const out = [];
    for (const c of activeList(shop.customers)) {
      if (c.ls && c.ls.placeholder) continue;
      const hit = phoneish
        ? [c.phone, c.phone2].some((ph) => digits(ph).includes(qd))
        : words.every((w) => `${c.first || ""} ${c.last || ""} ${c.company || ""} ${c.email || ""}`.toLowerCase().includes(w));
      if (hit) out.push(c);
      if (out.length >= 30) break;
    }
    return out
      .map((c) => ({ c, cars: vehiclesOf(shop.vehicles, c.id) }))
      .sort((a, b) => b.cars.length - a.cars.length || customerName(a.c).localeCompare(customerName(b.c)))
      .slice(0, 8);
  }, [mode, q, shop.customers, shop.vehicles]);

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
        shop={shop}
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

  if (step === "newCustomer")
    return (
      <CustomerForm
        cfg={cfg}
        initial={/\d{3}/.test(q) ? { phone: digits(q) } : { first: q.trim().split(/\s+/)[0] || "", last: q.trim().split(/\s+/).slice(1).join(" ") }}
        onClose={() => setStep("plate")}
        onSave={async (c) => {
          const saved = await shop.saveCustomer(c);
          setOwner(saved);
          setStep("carFor");
        }}
      />
    );

  if (step === "carFor" && owner)
    return (
      <VehicleForm
        cfg={cfg}
        shop={shop}
        customerId={owner.id}
        initial={{ plateState: state }}
        onClose={() => setStep("plate")}
        onSave={async (v) => {
          const saved = await shop.saveVehicle({ ...v, customerId: owner.id });
          start(saved);
        }}
      />
    );

  if (step === "edit" && chosen)
    return (
      <VehicleForm
        cfg={cfg}
        shop={shop}
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
            Yes, start the {startsAs}
          </button>
          <button className="btn lg" onClick={() => setStep("edit")}>
            Fix car details
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={title} onClose={onClose} size="wide">
      <div className="seg" style={{ marginBottom: 14 }}>
        <button className={mode === "plate" ? "on" : ""} onClick={() => setMode("plate")}>
          By plate
        </button>
        <button className={mode === "name" ? "on" : ""} onClick={() => setMode("name")}>
          By name or phone
        </button>
      </div>
      {mode === "name" ? (
        <>
          <Field label="Customer name, company, or phone">
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Maria Alvarez or 619 555" style={{ fontSize: 22, fontWeight: 600 }} />
          </Field>
          {q.trim().length >= 2 && people.length === 0 && <p className="muted">No customer matches.</p>}
          {people.length > 0 && (
            <ul className="pickList personPick" style={{ marginTop: 0 }}>
              {people.map(({ c, cars }) => (
                <li key={c.id} style={{ cursor: "default", display: "block" }}>
                  <div className="main">
                    <strong>{customerName(c)}</strong>
                    <span>{[c.company && c.first ? c.company : "", c.phone ? fmtPhone(c.phone) : "", cars.length ? `${cars.length} car${cars.length === 1 ? "" : "s"}` : "no car on file"].filter(Boolean).join(" · ")}</span>
                  </div>
                  <div className="carChips">
                    {cars.map((v) => (
                      <button key={v.id} type="button" className="btn tiny" onClick={() => (setChosen(v), setStep("confirm"))}>
                        {vehicleName(v)}
                        {v.plate ? ` · ${v.plate}` : ""}
                      </button>
                    ))}
                    <button type="button" className="btn tiny ghost" onClick={() => (setOwner(c), setStep("carFor"))}>
                      {cars.length ? "+ Another car" : "+ Add a car"}
                    </button>
                    {cars.length === 0 && (
                      <button type="button" className="btn tiny ghost" onClick={() => onStart({ customerId: c.id })}>
                        Start without a car
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="rowBtns" style={{ marginTop: 14 }}>
            <button className="btn primary" onClick={() => setStep("newCustomer")}>
              New customer
            </button>
            <button className="btn ghost" onClick={() => onStart({})}>
              Skip, walk-in
            </button>
          </div>
        </>
      ) : (
      <>
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
        A plate on file shows the car to confirm, then opens the {startsAs}. A new plate{" "}
        {cfg.plateApiKey ? "is looked up and the car is built from it" : "opens a blank car to fill in"}. The customer's name
        and number go on the ticket whenever they're ready, from the Customer button at the top.
      </p>
      </>
      )}
    </Modal>
  );
}
