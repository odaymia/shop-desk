import { useState, useEffect } from "react";
import { Modal } from "./ui.jsx";
import { motorVehicle, motorContent, motorContentDetail } from "../lib/motor.js";

/* MOTOR reference — browse everything MOTOR has for the vehicle: fluids & specs,
   parts, labor times, factory maintenance, service procedures, TSBs, trouble
   codes, component locations, wiring. A tab per domain; click an item to pull
   its detail. Read-only reference (the estimate-building lookups are the
   separate Labor guide and Service review). */
const TABS = [
  ["Fluids", "Fluids & specs", "Fluids"],
  ["Specifications", "Specifications", "Specifications"],
  ["Parts", "Parts", "Parts"],
  ["EstimatedWorkTimes", "Labor times", "Labor"],
  ["MaintenanceSchedules", "Maintenance", "Maintenance"],
  ["ServiceProcedures", "Procedures", "Service procedures"],
  ["TechnicalServiceBulletins", "TSBs", "Technical service bulletins"],
  ["DiagnosticTroubleCodes", "Trouble codes", "Diagnostic trouble codes"],
  ["ComponentLocations", "Locations", "Component locations"],
  ["WiringDiagrams", "Wiring", "Wiring diagrams"],
];

const SKIP = /^(attributes|engines|links|attributemappings|contentsilos|documentsets|documents|position|category|qualifiers|isactive)$/i;
const KEEP = /(text|value|description|note|name|number|qty|quantity|capacity|type|amount|title|desc|gap|torque|interval|code|specification|spec|unit|frequency|severe|hours|labortime|viscosity|grade)/i;
const nice = (k) => k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");

/* Pull the human-readable bits out of MOTOR's deep detail JSON. */
function readable(obj, out = [], depth = 0) {
  if (depth > 7 || out.length > 80) return out;
  if (Array.isArray(obj)) obj.forEach((o) => readable(o, out, depth + 1));
  else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (SKIP.test(k)) continue;
      if ((typeof v === "string" || typeof v === "number") && String(v).trim() && KEEP.test(k)) {
        const s = String(v).trim();
        if (s && !/^(-|N\/?A|0)$/i.test(s)) out.push(`${nice(k)}: ${s}`);
      } else if (v && typeof v === "object") readable(v, out, depth + 1);
    }
  }
  return out;
}

export function MotorReference({ vehicle, onClose }) {
  const [veh, setVeh] = useState(null);
  const [sample, setSample] = useState(false);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("Fluids");
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openItem, setOpenItem] = useState(null); // { name, lines }

  // decode the VIN once
  useEffect(() => {
    let live = true;
    const vin = String((vehicle && vehicle.vin) || "").trim();
    if (vin.length !== 17) {
      setErr("This vehicle needs a 17-character VIN for a MOTOR lookup.");
      setLoading(false);
      return;
    }
    (async () => {
      const r = await motorVehicle(vin);
      if (!live) return;
      setSample(!!r.sample);
      if (!r.vehicle) {
        setErr("MOTOR couldn't identify this VIN.");
        setLoading(false);
        return;
      }
      setVeh(r.vehicle);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // load the current tab whenever it (or the vehicle) changes
  useEffect(() => {
    if (!veh) return;
    let live = true;
    setLoading(true);
    setItems(null);
    setOpenItem(null);
    (async () => {
      const r = await motorContent(veh.baseVehicleId, tab);
      if (!live) return;
      setItems(r.items || []);
      if (r.sample) setSample(true);
      setLoading(false);
    })();
    return () => { live = false; };
  }, [veh, tab]);

  const open = async (it) => {
    setOpenItem({ name: it.name, lines: null });
    const r = await motorContentDetail(veh.baseVehicleId, tab, it.id);
    const lines = [...new Set(readable(r.detail || {}))];
    setOpenItem({ name: it.name, lines: lines.length ? lines : ["No further detail available in this dataset."] });
  };

  return (
    <Modal title="MOTOR vehicle data" onClose={onClose} size="huge">
      {sample && <p className="sampleNote">Sample data — connect MOTOR in the function's secrets to pull this vehicle's live data.</p>}
      {veh ? <p className="motorVeh">{[veh.year, veh.make, veh.model, veh.submodel].filter(Boolean).join(" ")} · {veh.engine}</p> : null}

      {err ? (
        <p className="fldErr">{err}</p>
      ) : (
        <>
          <div className="motorTabs">
            {TABS.map(([id, short]) => (
              <button key={id} type="button" className={`motorTab ${tab === id ? "on" : ""}`} onClick={() => setTab(id)}>
                {short}
              </button>
            ))}
          </div>

          {openItem ? (
            <div className="motorDetail">
              <button className="btn tiny" onClick={() => setOpenItem(null)}>← Back to list</button>
              <h3 style={{ margin: "10px 0 6px" }}>{openItem.name}</h3>
              {openItem.lines ? (
                <ul className="motorDetailList">
                  {openItem.lines.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">Loading…</p>
              )}
            </div>
          ) : loading ? (
            <p className="muted" style={{ padding: 16 }}>Loading…</p>
          ) : !items || items.length === 0 ? (
            <p className="muted" style={{ padding: 16 }}>Nothing here for this vehicle.</p>
          ) : (
            <div className="dataScroll">
              <table className="dk">
                <tbody>
                  {items.map((it, i) => (
                    <tr key={`${it.id}-${i}`} className="row" onClick={() => open(it)}>
                      <td>{it.name}</td>
                      <td className="r muted" style={{ whiteSpace: "nowrap" }}>View ›</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="legalNote" style={{ marginTop: 12 }}>
            {(TABS.find((t) => t[0] === tab) || [])[2]} for this vehicle, from MOTOR. Reference only — MOTOR data is kept out of any AI features.
          </p>
        </>
      )}
    </Modal>
  );
}
