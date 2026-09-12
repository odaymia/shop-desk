import { useState, useMemo, useEffect, useRef } from "react";
import { Modal, Field, Text, Num, fmtPhone } from "./ui.jsx";
import { decodeVin, isVin } from "../lib/vin.js";
import { lookupPlate } from "../lib/plate.js";
import { buildYmme, modelYears } from "../lib/ymme.js";
import { customerName, vehicleName, activeList, vehiclesOf, searchText } from "./useShop.js";

/* A field that is a dropdown of known values with an escape hatch to type
   anything not on the list. Used for the Year/Make/Model/Engine cascade
   in the vehicle form. When the current value isn't one of the options
   (a VIN decode filled it, or an old record), it shows the text box so
   the value is always visible and editable. */
function PickOrType({ label, value, onChange, options, placeholder, numeric }) {
  const has = options.length > 0;
  const match = (v) => options.find((o) => String(o).toLowerCase() === String(v).toLowerCase());
  const inList = value != null && value !== "" && !!match(value);
  const [typing, setTyping] = useState(!has || (value != null && value !== "" && !inList));
  useEffect(() => {
    if (value != null && value !== "" && !inList && has) setTyping(true);
  }, [value, inList, has]);

  if (!has || typing) {
    const Input = numeric ? Num : Text;
    return (
      <Field label={label}>
        <Input value={value} onChange={onChange} placeholder={placeholder} />
        {has && (
          <button type="button" className="pickInstead" onClick={() => setTyping(false)}>
            Choose from the list
          </button>
        )}
      </Field>
    );
  }
  return (
    <Field label={label}>
      <select
        value={inList ? match(value) : ""}
        onChange={(e) => {
          if (e.target.value === "__type__") {
            onChange("");
            setTyping(true);
          } else onChange(e.target.value);
        }}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value="__type__">Other — type it in…</option>
      </select>
    </Field>
  );
}

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

export function VehicleForm({ initial, customerId, onSave, onClose, cfg, autoLookup, shop }) {
  const [d, setD] = useState(() => ({ ...blankVehicle(customerId), ...(initial || {}) }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const set = (k) => (v) => setD((x) => ({ ...x, [k]: v }));

  /* Year → Make → Model → Engine choices from the cars this shop has
     serviced. Choosing a higher level clears the ones below it so the
     lists stay in step. */
  const ymme = useMemo(() => buildYmme(shop ? shop.vehicles : {}, shop ? shop.specs : {}), [shop]);
  const YEARS = useMemo(() => modelYears(), []);
  const setYear = (v) => setD((x) => (String(v) === String(x.year) ? { ...x, year: v } : { ...x, year: v, make: "", model: "", engine: "" }));
  const setMake = (v) => setD((x) => (v === x.make ? { ...x, make: v } : { ...x, make: v, model: "", engine: "" }));
  const setModel = (v) => setD((x) => (v === x.model ? { ...x, model: v } : { ...x, model: v, engine: "" }));
  const plateKey = cfg && cfg.plateApiKey;
  const applyDecode = (r) =>
    setD((x) => ({
      ...x,
      vin: r.vin || x.vin,
      year: r.year || x.year,
      make: r.make || x.make,
      model: r.model || x.model,
      submodel: r.submodel || x.submodel,
      engine: r.engine || x.engine,
      color: x.color || r.color || "",
    }));
  /* plate → VIN through the paid provider, then the free NHTSA decode
     fills in whatever the provider left blank */
  const fromPlate = async () => {
    setErr("");
    setNote("");
    setBusy(true);
    try {
      const r = await lookupPlate(d.plate, d.plateState, plateKey);
      applyDecode(r);
      setNote(`Found VIN ${r.vin}`);
      if (!r.make || !r.model || !r.engine) {
        try {
          const n = await decodeVin(r.vin);
          if (n) applyDecode(n);
        } catch {
          /* the plate result is enough */
        }
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const decode = async () => {
    setErr("");
    setBusy(true);
    try {
      const r = await decodeVin(d.vin);
      if (!r) setErr("Couldn't read that VIN. Check it and try again, or fill the fields in by hand.");
      else applyDecode(r);
    } catch {
      setErr("No connection to the VIN service right now. Fill the fields in by hand.");
    } finally {
      setBusy(false);
    }
  };
  const ran = useRef(false);
  useEffect(() => {
    if (autoLookup && plateKey && d.plate && !ran.current) {
      ran.current = true;
      fromPlate();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
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
        <Field label="Plate">
          <Text
            value={d.plate}
            onChange={(v) => set("plate")(v.toUpperCase())}
            placeholder="8ABC123"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && plateKey && !busy) fromPlate();
            }}
          />
        </Field>
        <Field label="State">
          <select value={d.plateState} onChange={(e) => set("plateState")(e.target.value)}>
            {US_STATES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <div className="fld">
          <span>&nbsp;</span>
          <button
            className="btn primary"
            onClick={fromPlate}
            disabled={busy || !d.plate.trim()}
            style={{ minHeight: 52 }}
            title={plateKey ? "Look up the VIN and vehicle from the plate" : "Add a plate lookup key under Settings to turn this on"}
          >
            {busy ? "Looking up…" : "Look up plate"}
          </button>
        </div>
      </div>
      {!plateKey && (
        <p className="setupNote" style={{ margin: "-6px 0 14px" }}>
          Plate lookup needs a key under Settings → Plate lookup. Until then, enter the VIN below.
        </p>
      )}
      <div className="fldRow">
        <Field label="VIN">
          <Text value={d.vin} onChange={(v) => set("vin")(v.toUpperCase())} placeholder="17 characters" />
        </Field>
        <div className="fld">
          <span>&nbsp;</span>
          <button className="btn" onClick={decode} disabled={!isVin(d.vin) || busy} style={{ minHeight: 52 }}>
            {busy ? "Decoding…" : "Decode VIN"}
          </button>
        </div>
      </div>
      {note && <p className="muted" style={{ margin: "-6px 0 14px", color: "var(--live)" }}>{note}</p>}
      <div className="fldRow">
        <PickOrType label="Year" value={d.year} onChange={setYear} options={YEARS} placeholder="Year" numeric />
        <PickOrType label="Make" value={d.make} onChange={setMake} options={ymme.makesFor(d.year)} placeholder="Make" />
        <PickOrType label="Model" value={d.model} onChange={setModel} options={ymme.modelsFor(d.year, d.make)} placeholder="Model" />
      </div>
      <div className="fldRow">
        <Field label="Trim">
          <Text value={d.submodel} onChange={set("submodel")} placeholder="SE" />
        </Field>
        <PickOrType label="Engine" value={d.engine} onChange={set("engine")} options={ymme.enginesFor(d.year, d.make, d.model)} placeholder="Engine" />
      </div>
      <div className="fldRow">
        <Field label="Color">
          <Text value={d.color} onChange={set("color")} />
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
