import { useState, useMemo } from "react";
import { Modal, Field, Text, Num, fmtPhone } from "./ui.jsx";
import { decodeVin, isVin } from "../lib/vin.js";
import { customerName, vehicleName, activeList, vehiclesOf, searchText } from "./useShop.js";

/* Customer and vehicle forms, plus the customer picker a ticket uses.
   Shared by the Customers page and the ticket editor. */

const US_STATES = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");

export const blankCustomer = () => ({
  first: "",
  last: "",
  company: "",
  phone: "",
  phone2: "",
  email: "",
  street: "",
  city: "",
  state: "CA",
  zip: "",
  notes: "",
  taxExempt: false,
  active: true,
});

export function CustomerForm({ initial, onSave, onClose }) {
  const [d, setD] = useState(() => ({ ...blankCustomer(), ...(initial || {}) }));
  const [err, setErr] = useState("");
  const set = (k) => (v) => setD((x) => ({ ...x, [k]: v }));
  const save = () => {
    if (!d.first.trim() && !d.last.trim() && !d.company.trim()) return setErr("Give them a name or a company.");
    onSave({ ...d, first: d.first.trim(), last: d.last.trim(), company: d.company.trim() });
  };
  return (
    <Modal title={d.id ? "Edit customer" : "New customer"} onClose={onClose} size="wide">
      <div className="fldRow">
        <Field label="First name">
          <Text value={d.first} onChange={set("first")} autoFocus />
        </Field>
        <Field label="Last name">
          <Text value={d.last} onChange={set("last")} />
        </Field>
      </div>
      <div className="fldRow">
        <Field label="Company (fleet, dealer)">
          <Text value={d.company} onChange={set("company")} />
        </Field>
        <Field label="Email">
          <Text value={d.email} onChange={set("email")} type="email" />
        </Field>
      </div>
      <div className="fldRow">
        <Field label="Phone">
          <Text value={d.phone} onChange={set("phone")} inputMode="tel" placeholder="(619) 555-0100" />
        </Field>
        <Field label="Second phone">
          <Text value={d.phone2} onChange={set("phone2")} inputMode="tel" />
        </Field>
      </div>
      <Field label="Street">
        <Text value={d.street} onChange={set("street")} />
      </Field>
      <div className="fldRow">
        <Field label="City">
          <Text value={d.city} onChange={set("city")} />
        </Field>
        <Field label="State">
          <select value={d.state} onChange={(e) => set("state")(e.target.value)}>
            {US_STATES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="ZIP">
          <Text value={d.zip} onChange={set("zip")} inputMode="numeric" />
        </Field>
      </div>
      <Field label="Notes (shown on the ticket, not on the invoice)">
        <textarea className="ta" value={d.notes} onChange={(e) => set("notes")(e.target.value)} />
      </Field>
      <label className="fld inline">
        <input type="checkbox" checked={!!d.taxExempt} onChange={(e) => set("taxExempt")(e.target.checked)} />
        <span>Tax exempt (resale certificate on file)</span>
      </label>
      {err && <p className="fldErr">{err}</p>}
      <button className="btn primary lg full" onClick={save}>
        Save customer
      </button>
    </Modal>
  );
}

export const blankVehicle = (customerId) => ({
  customerId,
  year: "",
  make: "",
  model: "",
  submodel: "",
  engine: "",
  vin: "",
  plate: "",
  plateState: "CA",
  color: "",
  mileage: "",
  notes: "",
  active: true,
});

export function VehicleForm({ initial, customerId, onSave, onClose }) {
  const [d, setD] = useState(() => ({ ...blankVehicle(customerId), ...(initial || {}) }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (v) => setD((x) => ({ ...x, [k]: v }));
  const decode = async () => {
    setErr("");
    setBusy(true);
    try {
      const r = await decodeVin(d.vin);
      if (!r) setErr("Couldn't read that VIN. Check it and try again, or fill the fields in by hand.");
      else
        setD((x) => ({
          ...x,
          vin: r.vin,
          year: r.year || x.year,
          make: r.make || x.make,
          model: r.model || x.model,
          submodel: r.submodel || x.submodel,
          engine: r.engine || x.engine,
        }));
    } catch {
      setErr("No connection to the VIN service right now. Fill the fields in by hand.");
    } finally {
      setBusy(false);
    }
  };
  const save = () => {
    if (!d.make.trim() && !d.model.trim()) return setErr("At least a make and model.");
    onSave({
      ...d,
      vin: d.vin.toUpperCase().trim(),
      plate: d.plate.toUpperCase().trim(),
      year: d.year ? Number(d.year) : "",
      mileage: d.mileage ? Number(d.mileage) : "",
    });
  };
  return (
    <Modal title={d.id ? "Edit vehicle" : "New vehicle"} onClose={onClose} size="wide">
      <div className="fldRow">
        <Field label="VIN">
          <Text value={d.vin} onChange={(v) => set("vin")(v.toUpperCase())} placeholder="17 characters" autoFocus />
        </Field>
        <div className="fld">
          <span>&nbsp;</span>
          <button className="btn" onClick={decode} disabled={!isVin(d.vin) || busy} style={{ minHeight: 52 }}>
            {busy ? "Decoding…" : "Decode VIN"}
          </button>
        </div>
      </div>
      <div className="fldRow">
        <Field label="Year">
          <Num value={d.year} onChange={set("year")} placeholder="2019" />
        </Field>
        <Field label="Make">
          <Text value={d.make} onChange={set("make")} placeholder="Toyota" />
        </Field>
        <Field label="Model">
          <Text value={d.model} onChange={set("model")} placeholder="Camry" />
        </Field>
      </div>
      <div className="fldRow">
        <Field label="Trim">
          <Text value={d.submodel} onChange={set("submodel")} placeholder="SE" />
        </Field>
        <Field label="Engine">
          <Text value={d.engine} onChange={set("engine")} placeholder="2.5L 4-cyl" />
        </Field>
        <Field label="Color">
          <Text value={d.color} onChange={set("color")} />
        </Field>
      </div>
      <div className="fldRow">
        <Field label="Plate">
          <Text value={d.plate} onChange={(v) => set("plate")(v.toUpperCase())} />
        </Field>
        <Field label="Plate state">
          <select value={d.plateState} onChange={(e) => set("plateState")(e.target.value)}>
            {US_STATES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Mileage">
          <Num value={d.mileage} onChange={set("mileage")} />
        </Field>
      </div>
      <Field label="Notes (oil spec, quirks, keys)">
        <textarea className="ta" value={d.notes} onChange={(e) => set("notes")(e.target.value)} />
      </Field>
      {err && <p className="fldErr">{err}</p>}
      <button className="btn primary lg full" onClick={save}>
        Save vehicle
      </button>
    </Modal>
  );
}

/* Search everyone; pick one, or add a new customer on the spot. */
export function CustomerPicker({ shop, onPick, onClose }) {
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const rows = useMemo(() => {
    const list = activeList(shop.customers).map((c) => {
      const vehs = vehiclesOf(shop.vehicles, c.id);
      return { c, vehs };
    });
    return list
      .filter(({ c, vehs }) =>
        searchText(
          q,
          c.first,
          c.last,
          c.company,
          c.phone,
          c.phone2,
          c.email,
          ...vehs.map((v) => `${vehicleName(v)} ${v.plate || ""} ${v.vin || ""}`)
        )
      )
      .sort((a, b) => customerName(a.c).localeCompare(customerName(b.c)))
      .slice(0, 60);
  }, [shop.customers, shop.vehicles, q]);

  if (adding)
    return (
      <CustomerForm
        onClose={() => setAdding(false)}
        onSave={async (c) => {
          const saved = await shop.saveCustomer(c);
          onPick(saved);
        }}
      />
    );

  return (
    <Modal title="Who's the customer?" onClose={onClose} size="wide">
      <div className="rowBtns">
        <input
          className="search"
          style={{ flex: 1 }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name, phone, plate, or vehicle"
          autoFocus
        />
        <button className="btn primary" onClick={() => setAdding(true)}>
          New customer
        </button>
      </div>
      <ul className="pickList">
        {rows.length === 0 && <li className="emptyNote">No one matches. Add them as a new customer.</li>}
        {rows.map(({ c, vehs }) => (
          <li key={c.id} onClick={() => onPick(c)}>
            <div className="main">
              <strong>{customerName(c)}</strong>
              <span>
                {[c.company && c.first ? c.company : "", fmtPhone(c.phone), vehs.map(vehicleName).join(" · ")]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
