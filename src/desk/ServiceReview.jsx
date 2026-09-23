import { useMemo, useState, useEffect } from "react";
import { Modal, fmtDate } from "./ui.jsx";
import { ordersOf } from "./useShop.js";
import { serviceReview, reviewCounts, mergeMotorIntervals, DEFAULT_SERVICE_INTERVALS } from "../lib/serviceReview.js";
import { motorVehicle, motorMaintenance } from "../lib/motor.js";

const STATUS = {
  due: { label: "Due now", cls: "due" },
  soon: { label: "Due soon", cls: "soon" },
  done: { label: "Done", cls: "done" },
  unknown: { label: "No record", cls: "unknown" },
};
const miles = (n) => (Number(n) || 0).toLocaleString() + " mi";

/* Service review: for the ticket's vehicle, show every maintenance service, when
   it was last done (from this car's history), and whether it's due — so the
   writer can recommend what's due at an oil change. */
export function ServiceReview({ order, cfg, shop, onClose, onAdd }) {
  const vehicle = shop.vehicles[order.vehicleId] || {};
  const vehOrders = useMemo(() => ordersOf(shop.orders, { vehicleId: order.vehicleId }), [shop.orders, order.vehicleId]);
  const baseIntervals = cfg.serviceIntervals || DEFAULT_SERVICE_INTERVALS;
  const [merged, setMerged] = useState(() => ({ intervals: baseIntervals, source: "generic" }));
  const [motorState, setMotorState] = useState("loading"); // loading | motor | motor-sample | generic

  // pull the vehicle's real factory schedule from MOTOR and override the generic intervals
  useEffect(() => {
    let live = true;
    const vin = String(vehicle.vin || "").trim();
    if (vin.length !== 17) {
      setMotorState("generic");
      return;
    }
    (async () => {
      try {
        const v = await motorVehicle(vin);
        if (!live) return;
        if (!v.vehicle) return setMotorState("generic");
        const m = await motorMaintenance(v.vehicle.baseVehicleId);
        if (!live) return;
        const mm = mergeMotorIntervals(baseIntervals, m.services);
        if (mm.matched > 0) {
          setMerged(mm);
          setMotorState(v.sample || m.sample ? "motor-sample" : "motor");
        } else setMotorState("generic");
      } catch {
        if (live) setMotorState("generic");
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const intervals = merged.intervals;
  const guessMileage = Number(order.mileageOut) || Number(order.mileageIn) || vehOrders.reduce((m, o) => Math.max(m, Number(o.mileageOut) || Number(o.mileageIn) || 0), 0) || Number(vehicle.mileage) || 0;
  const [mileage, setMileage] = useState(String(guessMileage || ""));
  const cur = Number(mileage) || 0;

  const rows = useMemo(() => serviceReview(intervals, vehOrders, cur, order.id), [intervals, vehOrders, cur, order.id]);
  const counts = reviewCounts(rows);
  const [added, setAdded] = useState({});

  const add = (r) => {
    onAdd(r);
    setAdded((m) => ({ ...m, [r.id]: true }));
  };
  const addAllDue = () => {
    rows.filter((r) => r.status === "due" && !added[r.id]).forEach(add);
  };

  const veh = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "This vehicle";

  return (
    <Modal title="Service review" onClose={onClose} size="huge">
      <div className="svcHead">
        <div>
          <strong>{veh}</strong>
          <div className="muted" style={{ fontSize: 13 }}>
            {motorState === "loading"
              ? "Loading the factory schedule…"
              : motorState === "motor"
                ? "✓ Factory schedule from MOTOR · checked against this car's history"
                : motorState === "motor-sample"
                  ? "Factory schedule (MOTOR sample) · checked against this car's history"
                  : "General intervals · checked against this car's history"}
          </div>
        </div>
        <label className="fld" style={{ width: 150 }}>
          <span>Current mileage</span>
          <input inputMode="numeric" value={mileage} onChange={(e) => setMileage(e.target.value.replace(/[^0-9]/g, ""))} placeholder="e.g. 62000" />
        </label>
      </div>

      <div className="svcTally">
        <b className="vFail">{counts.due} due</b>
        <b className="vAdvise">{counts.soon} soon</b>
        <b className="vGood">{counts.done} up to date</b>
        {counts.due > 0 && (
          <button className="btn tiny primary" style={{ marginLeft: "auto" }} onClick={addAllDue}>
            Add all due to estimate
          </button>
        )}
      </div>

      <div className="dataScroll">
        <table className="dk">
          <thead>
            <tr>
              <th>Service</th>
              <th>Every</th>
              <th>Last done</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = STATUS[r.status] || STATUS.unknown;
              return (
                <tr key={r.id}>
                  <td>
                    <strong>{r.name}</strong>
                    {r.status === "due" && r.lastDone && r.nextDueMiles ? (
                      <span className="sub muted">was due at {miles(r.nextDueMiles)}</span>
                    ) : r.status === "due" && !r.lastDone ? (
                      <span className="sub muted">no record on file</span>
                    ) : r.status === "soon" && r.nextDueMiles ? (
                      <span className="sub muted">due at {miles(r.nextDueMiles)}</span>
                    ) : null}
                  </td>
                  <td className="muted">
                    {miles(r.miles)}
                    {r.months ? ` / ${r.months} mo` : ""}
                    {r.source === "MOTOR" ? <span className="sub" style={{ color: "#1657d6" }}>MOTOR</span> : null}
                  </td>
                  <td className="muted">{r.lastDone ? `${miles(r.lastDone.mileage)} · ${fmtDate(r.lastDone.at)}` : "—"}</td>
                  <td>
                    <span className={`svcBadge ${st.cls}`}>{st.label}</span>
                  </td>
                  <td className="r">
                    {r.status !== "done" && (
                      <button className="btn tiny primary" onClick={() => add(r)}>
                        {added[r.id] ? "Added" : "Add"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="legalNote" style={{ marginTop: 12 }}>
        {merged.source === "MOTOR"
          ? 'Intervals marked "MOTOR" are this vehicle\'s factory schedule; the rest use your general intervals (Settings).'
          : "Intervals are a general guide — edit them in Settings. Connect MOTOR to use each vehicle's factory schedule."}{" "}
        "Done" is detected from this car's past tickets.
      </p>
    </Modal>
  );
}
