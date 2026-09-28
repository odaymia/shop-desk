import { useEffect, useState } from "react";
import { Modal, Field } from "./ui.jsx";
import { motorYmme, motorVehicle } from "../lib/motor.js";

/* Link a car to its MOTOR vehicle by year, make, model and engine (or by
   VIN). Every MOTOR feature (labor guide, service review, filters, MOTOR
   data) then uses the saved link instead of needing a VIN each time. The
   car's own year/make/model pre-pick the lists. */
export function MotorLink({ vehicle, onSave, onClose, flash }) {
  const [years, setYears] = useState([]);
  const [makes, setMakes] = useState([]);
  const [models, setModels] = useState([]);
  const [year, setYear] = useState(String(vehicle.year || ""));
  const [makeId, setMakeId] = useState("");
  const [modelId, setModelId] = useState("");
  const [found, setFound] = useState(null); // { baseVehicleId, engines, sample, raw }
  const [engineId, setEngineId] = useState("");
  const [busy, setBusy] = useState("");
  const [raw, setRaw] = useState(null); // an answer we couldn't read, shown so it can be fixed
  const low = (s) => String(s || "").trim().toLowerCase();

  const run = async (label, fn) => {
    setBusy(label);
    try {
      return await fn();
    } catch (e) {
      flash(e.message || "MOTOR lookup failed", "out");
      return null;
    } finally {
      setBusy("");
    }
  };

  useEffect(() => {
    run("years", async () => {
      const r = await motorYmme("years");
      if (r.error) throw new Error(r.error);
      setYears(r.years || []);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setMakes([]);
    setMakeId("");
    setModels([]);
    setModelId("");
    setFound(null);
    if (!year) return;
    run("makes", async () => {
      const r = await motorYmme("makes", { year });
      if (r.error) throw new Error(r.error);
      if (!(r.makes || []).length && r.raw) setRaw(r.raw);
      setMakes(r.makes || []);
      const m = (r.makes || []).find((x) => low(x.name) === low(vehicle.make));
      if (m) setMakeId(m.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  useEffect(() => {
    setModels([]);
    setModelId("");
    setFound(null);
    if (!year || !makeId) return;
    run("models", async () => {
      const r = await motorYmme("models", { year, makeId });
      if (r.error) throw new Error(r.error);
      if (!(r.models || []).length && r.raw) setRaw(r.raw);
      setModels(r.models || []);
      const m = (r.models || []).find((x) => low(x.name) === low(vehicle.model)) || (r.models || []).find((x) => low(vehicle.model).startsWith(low(x.name)));
      if (m) setModelId(m.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, makeId]);

  useEffect(() => {
    setFound(null);
    setEngineId("");
    if (!year || !makeId || !modelId) return;
    run("vehicle", async () => {
      const r = await motorYmme("vehicle", { year, makeId, modelId });
      if (r.error) throw new Error(r.error);
      if (!r.baseVehicleId && r.raw) setRaw(r.raw);
      setFound(r);
      /* the car's engine size ("2.5L", or "2.5 16V" from a VIN decode);
         skip hybrids unless the car says hybrid */
      const eng = String(vehicle.engine || "");
      const liters = (eng.match(/\b(\d\.\d)\s*L?\b/i) || [])[1];
      const hybrid = /hybrid|hev/i.test(eng);
      const fits = (r.engines || []).filter((x) => liters && String(x.name).includes(`${liters}L`) && /hybrid|hev/i.test(x.name) === hybrid);
      const e = (r.engines || []).length === 1 ? r.engines[0] : fits[0];
      if (e) setEngineId(e.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, makeId, modelId]);

  const save = () => {
    const make = makes.find((m) => m.id === makeId);
    const model = models.find((m) => m.id === modelId);
    const engine = (found.engines || []).find((e) => e.id === engineId);
    onSave({
      baseVehicleId: String(found.baseVehicleId),
      engineId: engineId || "",
      year,
      make: make ? make.name : "",
      model: model ? model.name : "",
      engine: engine ? engine.name : "",
      sample: !!found.sample,
      linkedAt: Date.now(),
    });
  };

  const byVin = () =>
    run("vin", async () => {
      const r = await motorVehicle(vehicle.vin);
      if (!r.vehicle) throw new Error(r.error || "MOTOR didn't find that VIN. Use year, make and model instead.");
      const v = r.vehicle;
      onSave({ baseVehicleId: String(v.baseVehicleId), engineId: String(v.engineId || ""), year: String(v.year || ""), make: v.make || "", model: v.model || "", engine: v.engine || "", sample: !!r.sample, linkedAt: Date.now() });
    });

  const needsEngine = found && (found.engines || []).length > 1 && !engineId;

  return (
    <Modal title="Link this car to MOTOR" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        Pick the car as MOTOR lists it. The labor guide, service review, filters and MOTOR data all use this link from now on.
      </p>
      <div className="fldRow">
        <Field label="Year">
          <select value={year} onChange={(e) => setYear(e.target.value)} disabled={!!busy && busy === "years"}>
            <option value="">{busy === "years" ? "Loading…" : "Year"}</option>
            {[...new Set([...(year ? [year] : []), ...years])].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Make">
          <select value={makeId} onChange={(e) => setMakeId(e.target.value)} disabled={!makes.length}>
            <option value="">{busy === "makes" ? "Loading…" : "Make"}</option>
            {makes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="fldRow">
        <Field label="Model">
          <select value={modelId} onChange={(e) => setModelId(e.target.value)} disabled={!models.length}>
            <option value="">{busy === "models" ? "Loading…" : "Model"}</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Engine">
          <select value={engineId} onChange={(e) => setEngineId(e.target.value)} disabled={!found || !(found.engines || []).length}>
            <option value="">{busy === "vehicle" ? "Loading…" : found && !(found.engines || []).length ? "Any" : "Engine"}</option>
            {((found && found.engines) || []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {found && found.baseVehicleId ? (
        <p className="muted" style={{ margin: "4px 0 10px" }}>
          MOTOR base vehicle <strong>{found.baseVehicleId}</strong>
          {found.sample ? " (sample, MOTOR isn't connected)" : ""}
        </p>
      ) : null}
      {raw && (
        <details style={{ margin: "6px 0 10px" }}>
          <summary className="muted">MOTOR answered in a shape the desk didn't expect (tap to see it)</summary>
          <pre style={{ fontSize: 11, maxHeight: 200, overflow: "auto", whiteSpace: "pre-wrap" }}>{JSON.stringify(raw, null, 1).slice(0, 4000)}</pre>
        </details>
      )}
      <div className="rowBtns" style={{ marginTop: 10 }}>
        <button className="btn primary lg" disabled={!found || !found.baseVehicleId || needsEngine || !!busy} onClick={save}>
          {needsEngine ? "Pick the engine" : "Link to MOTOR"}
        </button>
        {String(vehicle.vin || "").trim().length === 17 && (
          <button className="btn lg" disabled={!!busy} onClick={byVin}>
            {busy === "vin" ? "Looking up…" : "Use the VIN instead"}
          </button>
        )}
      </div>
    </Modal>
  );
}
