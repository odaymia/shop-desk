import { useState } from "react";
import { Modal, Field, Text, Num } from "./ui.jsx";
import { blankSpec, normalizeViscosity } from "../lib/specs.js";
import { vehicleName } from "./useShop.js";

/* Enter or fix the service specs for one engine. Saved once, it comes up
   for every car with that year, make, model and engine. */
export function SpecForm({ vehicle, initial, onSave, onClose }) {
  const [d, setD] = useState(() => ({ ...blankSpec(vehicle), ...(initial || {}), year: Number(vehicle.year) || "", make: vehicle.make, model: vehicle.model, engine: vehicle.engine }));
  const [err, setErr] = useState("");
  const set = (k) => (v) => setD((x) => ({ ...x, [k]: v }));
  const filters = d.oilFilters && d.oilFilters.length ? d.oilFilters : [{ brand: "", number: "" }];
  const setFilter = (i, patch) => set("oilFilters")(filters.map((f, k) => (k === i ? { ...f, ...patch } : f)));
  const save = () => {
    const visc = normalizeViscosity(d.oilViscosity);
    if (!/^\d{1,2}W-\d{2}$/.test(visc)) return setErr("Oil grade should look like 0W-20 or 5W-30.");
    if (!(Number(d.oilCapacityQt) > 0)) return setErr("How many quarts, with the filter?");
    onSave({
      ...d,
      oilViscosity: visc,
      oilCapacityQt: Math.round(Number(d.oilCapacityQt) * 10) / 10,
      oilFilters: filters.filter((f) => f.number && f.number.trim()).map((f) => ({ brand: f.brand.trim(), number: f.number.trim().toUpperCase() })),
      source: d.source || "shop",
    });
  };
  return (
    <Modal title={`Specs: ${vehicleName(vehicle)}`} onClose={onClose} size="wide">
      <p className="muted" style={{ marginTop: 0 }}>
        {vehicle.engine ? `${vehicle.engine} engine. ` : ""}Saved for every {vehicle.year} {vehicle.make} {vehicle.model} with this engine.
      </p>
      <div className="fldRow">
        <Field label="Oil grade">
          <Text value={d.oilViscosity} onChange={set("oilViscosity")} placeholder="0W-20" autoFocus onBlur={() => set("oilViscosity")(normalizeViscosity(d.oilViscosity))} />
        </Field>
        <Field label="Oil spec (from the cap or manual)">
          <Text value={d.oilSpec} onChange={set("oilSpec")} placeholder="API SP / ILSAC GF-6A / dexos1" />
        </Field>
        <Field label="Quarts, with filter">
          <Num value={d.oilCapacityQt} onChange={set("oilCapacityQt")} placeholder="4.8" />
        </Field>
      </div>
      <div className="subhead">Oil filter part numbers</div>
      <div className="miniLines">
        {filters.map((f, i) => (
          <div key={i} className="miniLine" style={{ gridTemplateColumns: "1fr 1fr 36px" }}>
            <input value={f.brand} onChange={(e) => setFilter(i, { brand: e.target.value })} placeholder="Brand (Valvoline, Fram, Toyota)" />
            <input value={f.number} onChange={(e) => setFilter(i, { number: e.target.value })} placeholder="Part number" />
            <button className="lineX" onClick={() => set("oilFilters")(filters.filter((_, k) => k !== i))} aria-label="Remove">
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="addBar">
        <button className="btn tiny" onClick={() => set("oilFilters")([...filters, { brand: "", number: "" }])}>
          + Another filter number
        </button>
      </div>
      <div className="fldRow" style={{ marginTop: 14 }}>
        <Field label="Drain plug torque">
          <Text value={d.drainPlugTorque} onChange={set("drainPlugTorque")} placeholder="30 ft-lb" />
        </Field>
        <Field label="Maintenance light reset">
          <Text value={d.resetProcedure} onChange={set("resetProcedure")} placeholder="Trip A, hold reset, key on…" />
        </Field>
      </div>
      <Field label="Other fluids (transmission, coolant, diff…)">
        <textarea className="ta" value={d.otherFluids} onChange={(e) => set("otherFluids")(e.target.value)} placeholder="ATF WS 3.5 qt drain & fill · Coolant Toyota SLLC pink" />
      </Field>
      <Field label="Notes for the tech">
        <textarea className="ta" value={d.notes} onChange={(e) => set("notes")(e.target.value)} placeholder="Cartridge filter under the intake; skid plate off first" />
      </Field>
      {err && <p className="fldErr">{err}</p>}
      <button className="btn primary lg full" onClick={save}>
        Save specs
      </button>
    </Modal>
  );
}
