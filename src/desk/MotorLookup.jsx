import { useState, useEffect } from "react";
import { Modal } from "./ui.jsx";
import { motorVehicle, motorLabor } from "../lib/motor.js";

/* MOTOR labor guide. Decodes the ticket's VIN to a MOTOR vehicle, then lets the
   writer search the labor operations and drop one onto the estimate with the
   exact book time. Add several without closing. */
export function MotorLookup({ vehicle, cfg, onClose, onAddLabor }) {
  const [veh, setVeh] = useState(null);
  const [sample, setSample] = useState(false);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [labor, setLabor] = useState([]);
  const [added, setAdded] = useState({});
  const [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      const vin = String((vehicle && vehicle.vin) || "").trim();
      if (vin.length !== 17) {
        setErr("This vehicle needs a 17-character VIN on file for a MOTOR lookup.");
        setLoading(false);
        return;
      }
      const r = await motorVehicle(vin);
      if (!live) return;
      setSample(!!r.sample);
      if (!r.vehicle) {
        setErr("MOTOR couldn't identify this VIN.");
        setLoading(false);
        return;
      }
      setVeh(r.vehicle);
      const l = await motorLabor(r.vehicle.baseVehicleId, "");
      if (!live) return;
      setLabor(l.labor || []);
      setLoading(false);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const search = async (term) => {
    if (!veh) return;
    setLoading(true);
    const l = await motorLabor(veh.baseVehicleId, term);
    setLabor(l.labor || []);
    setLoading(false);
  };

  const add = (op) => {
    onAddLabor(op);
    setAdded((m) => ({ ...m, [op.name]: (m[op.name] || 0) + 1 }));
  };

  return (
    <Modal title="MOTOR labor guide" onClose={onClose} size="lg">
      {sample && <p className="sampleNote">Sample data — connect MOTOR in the function's secrets to pull live labor times.</p>}
      {veh ? (
        <p className="motorVeh">
          {[veh.year, veh.make, veh.model, veh.submodel].filter(Boolean).join(" ")} · {veh.engine}
        </p>
      ) : null}

      {err ? (
        <p className="fldErr">{err}</p>
      ) : (
        <>
          <div className="rowBtns" style={{ marginBottom: 10 }}>
            <input
              className="search"
              style={{ flex: 1 }}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search(q)}
              placeholder="Search a repair — brakes, alternator, water pump…"
            />
            <button className="btn" onClick={() => search(q)}>Search</button>
          </div>

          {loading ? (
            <p className="muted" style={{ padding: 16 }}>Loading…</p>
          ) : labor.length === 0 ? (
            <p className="muted" style={{ padding: 16 }}>No labor operations match. Try a different word.</p>
          ) : (
            <div className="tableCard scroll" style={{ maxHeight: 420 }}>
              <table className="dk">
                <tbody>
                  {labor.map((op) => (
                    <tr key={op.name}>
                      <td>
                        <strong>{op.name}</strong>
                        {op.notes && op.notes.length ? <span className="sub">{op.notes[0]}</span> : null}
                        {op.skill ? <span className="sub muted">{op.serviceType} · {op.skill} skill</span> : null}
                      </td>
                      <td className="r num" style={{ whiteSpace: "nowrap" }}>
                        <b>{op.hours ? `${op.hours.toFixed(1)} hr` : "—"}</b>
                      </td>
                      <td className="r">
                        <button className="btn tiny primary" onClick={() => add(op)}>
                          {added[op.name] ? `Added${added[op.name] > 1 ? ` ×${added[op.name]}` : ""}` : "Add"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="legalNote" style={{ marginTop: 12 }}>
            Labor lines use your shop rate ({cfg.laborRate ? `$${cfg.laborRate}/hr` : "set in Settings"}) × MOTOR's book time. Adjust any line on the ticket.
          </p>
        </>
      )}
    </Modal>
  );
}
