import { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Modal, fmtDate, fmtPhone } from "./ui.jsx";
import { fmtMoney } from "../lib/invoice.js";
import { ordersOf } from "./useShop.js";
import { serviceReview, reviewCounts, mergeMotorIntervals, activeIntervals, filterApplicable, servicePart, DEFAULT_SERVICE_INTERVALS } from "../lib/serviceReview.js";
import { motorVehicleFor, motorMaintenance, motorFluids, motorFilters } from "../lib/motor.js";
import { specFromMotorFilters, pickEngine } from "../lib/motorFilters.js";

const STATUS = {
  due: { label: "Due now", cls: "due" },
  soon: { label: "Due soon", cls: "soon" },
  inspect: { label: "Inspect", cls: "inspect" },
  done: { label: "Done", cls: "done" },
  unknown: { label: "No record", cls: "unknown" },
};
const miles = (n) => (Number(n) || 0).toLocaleString() + " mi";

/* Service review: for the ticket's vehicle, show every maintenance service, when
   it was last done (from this car's history), and whether it's due — so the
   writer can recommend what's due at an oil change. */
export function ServiceReview({ order, cfg, shop, spec, onClose, onAdd }) {
  const vehicle = shop.vehicles[order.vehicleId] || {};
  const [motorFilterSpec, setMotorFilterSpec] = useState(null); // exact filter numbers from live MOTOR
  const vehOrders = useMemo(() => ordersOf(shop.orders, { vehicleId: order.vehicleId }), [shop.orders, order.vehicleId]);
  const mode = cfg.serviceIntervalSource || "both"; // store | motor | both
  const storeLabel = String(cfg.serviceStoreLabel || "Store").trim() || "Store";
  const baseIntervals = activeIntervals(cfg.serviceIntervals || DEFAULT_SERVICE_INTERVALS);
  const [merged, setMerged] = useState(() => ({ intervals: mergeMotorIntervals(baseIntervals, [], "store").intervals, source: "store" }));
  const [motorState, setMotorState] = useState(mode === "store" ? "store" : "loading"); // loading | motor | motor-sample | store
  const [motorWhy, setMotorWhy] = useState(""); // why the manufacturer schedule isn't showing

  // pull the vehicle's real factory schedule from MOTOR (unless the owner chose store-only)
  useEffect(() => {
    if (mode === "store") return;
    let live = true;
    if (String(vehicle.vin || "").trim().length !== 17 && !(vehicle.motor && vehicle.motor.baseVehicleId)) {
      setMotorState("store");
      return;
    }
    (async () => {
      try {
        const v = await motorVehicleFor(vehicle);
        if (!live) return;
        if (!v.vehicle) return setMotorWhy(v.error || "MOTOR didn't find this car."), setMotorState("store");
        const [m, f, fil] = await Promise.all([
          motorMaintenance(v.vehicle.baseVehicleId, v.vehicle.engineId),
          motorFluids(v.vehicle.baseVehicleId),
          motorFilters(v.vehicle.baseVehicleId).catch(() => null),
        ]);
        if (!live) return;
        if (m.error) throw new Error(m.error);
        /* the exact filter part numbers MOTOR lists for this car — used to put
           the right part (and its price) on parts services. Real data only. */
        if (fil && !fil.sample && !fil.error) {
          const en = pickEngine(fil.engines, { engineId: v.vehicle.engineId, engineText: vehicle.engine });
          if (en || (fil.engines || []).length <= 1) setMotorFilterSpec(specFromMotorFilters(fil, en));
        }
        const isSample = v.sample || m.sample || f.sample;
        // only hide services from REAL per-vehicle data — never from the sample fallback
        const motorNames = [...(f.fluids || []).map((x) => x.name), ...(m.services || []).map((x) => x.name)];
        const applicable = isSample ? baseIntervals : filterApplicable(baseIntervals, motorNames);
        const mm = mergeMotorIntervals(applicable, m.services, mode, cfg.serviceSeverity === "severe" ? "severe" : "normal");
        if (mm.matched > 0 || applicable.length !== baseIntervals.length) {
          setMerged(mm);
          setMotorState(v.sample || m.sample ? "motor-sample" : "motor");
        } else {
          setMotorWhy(
            (m.services || []).length
              ? `MOTOR sent ${m.services.length} schedule items for this car, but none matched these services.`
              : "MOTOR sent no maintenance schedule for this car."
          );
          setMotorState("store");
        }
      } catch (e) {
        if (live) {
          setMotorWhy(`Couldn't read MOTOR's schedule: ${e.message || "lookup failed"}`);
          setMotorState("store");
        }
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const intervals = merged.intervals;
  const guessMileage = Number(order.mileageOut) || Number(order.mileageIn) || vehOrders.reduce((m, o) => Math.max(m, Number(o.mileageOut) || Number(o.mileageIn) || 0), 0) || Number(vehicle.mileage) || 0;
  const [mileage, setMileage] = useState(String(guessMileage || ""));
  const cur = Number(mileage) || 0;

  /* the filter numbers for this exact car: the shop's saved spec first, then
     anything live MOTOR added, so parts match the right part for the vehicle */
  const partSpec = useMemo(() => {
    const base = spec || {};
    const mf = motorFilterSpec;
    if (!mf) return base;
    const pick = (a, b) => (a && a.length ? a : b || []);
    return {
      ...base,
      oilFilters: pick(base.oilFilters, mf.oilFilters),
      airFilters: pick(base.airFilters, mf.airFilters),
      cabinFilters: pick(base.cabinFilters, mf.cabinFilters),
      fuelFilters: pick(base.fuelFilters, mf.fuelFilters),
      wipers: pick(base.wipers, mf.wipers),
    };
  }, [spec, motorFilterSpec]);

  /* attach the real inventory part (number + price) to services that install one */
  const rows = useMemo(() => {
    return serviceReview(intervals, vehOrders, cur, order.id).map((r) => {
      const part = servicePart(shop.parts, r, partSpec);
      return { ...r, part, effPrice: part ? Number(part.price) || 0 : Number(r.price) || 0 };
    });
  }, [intervals, vehOrders, cur, order.id, shop.parts, partSpec]);
  const counts = reviewCounts(rows);
  const [added, setAdded] = useState({});

  const add = (r) => {
    onAdd(r);
    setAdded((m) => ({ ...m, [r.id]: true }));
  };
  const addAllDue = () => {
    rows.filter((r) => r.status === "due" && !added[r.id]).forEach(add);
  };
  const print = () => window.print();

  const veh = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "This vehicle";
  const idBits = [vehicle.plate ? `Plate ${vehicle.plate}${vehicle.plateState ? ` (${vehicle.plateState})` : ""}` : "", vehicle.vin ? `VIN ${vehicle.vin}` : ""].filter(Boolean).join(" · ");
  const target = (typeof document !== "undefined" && (document.querySelector(".root") || document.body)) || null;
  const printNode = (
    <div className="printSheet">
      <style>{`@media print { @page { size: auto; margin: 0.5in; } }`}</style>
      <div className="printWrap">
        <div className="srSheet">
          <div className="srSheetHead">
            <div>
              <div className="srShop">{cfg.shopName || "Service Review"}</div>
              {cfg.shopAddress ? <div className="srSub">{cfg.shopAddress}</div> : null}
              {cfg.shopPhone ? <div className="srSub">{fmtPhone(cfg.shopPhone)}</div> : null}
            </div>
            <div className="srWhen">
              Service Review
              <span>{new Date().toLocaleDateString()}</span>
            </div>
          </div>
          <div className="srVeh">
            <strong>{veh}</strong>
            {idBits ? ` · ${idBits}` : ""}
            {cur ? ` · ${cur.toLocaleString()} mi` : ""}
          </div>
          <table className="srTable">
            <thead>
              <tr>
                <th>Service</th>
                <th>Part #</th>
                <th>Every</th>
                <th>Last done</th>
                <th>Status</th>
                <th className="r">Price</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.part && r.part.number ? r.part.number : ""}</td>
                  <td>{r.basis === "inspect" ? "On inspection" : `${miles(r.miles)}${r.months ? ` / ${r.months} mo` : ""}`}</td>
                  <td>{r.lastDone ? `${miles(r.lastDone.mileage)} · ${fmtDate(r.lastDone.at)}` : "—"}</td>
                  <td>{(STATUS[r.status] || STATUS.unknown).label}</td>
                  <td className="r">{r.effPrice ? fmtMoney(r.effPrice) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="srNote">Recommendations from your maintenance schedule, checked against this vehicle's service history. Prices are estimates and may change once the work is inspected.</p>
        </div>
      </div>
    </div>
  );

  return (
    <>
    <Modal title="Service review" onClose={onClose} size="huge">
      <div className="svcHead">
        <div>
          <strong>{veh}</strong>
          <div className="muted" style={{ fontSize: 13 }}>
            {motorState === "loading"
              ? "Loading the manufacturer schedule…"
              : motorState === "motor"
                ? `✓ ${mode === "both" ? `${storeLabel} + manufacturer` : "Manufacturer"} recommendations (${cfg.serviceSeverity === "severe" ? "severe service" : "normal driving"}) · checked against this car's history`
                : motorState === "motor-sample"
                  ? `${mode === "both" ? `${storeLabel} + manufacturer` : "Manufacturer"} recommendations (sample) · checked against this car's history`
                  : `${storeLabel} recommendations · checked against this car's history`}
            {motorState === "store" && motorWhy ? <div style={{ color: "var(--warn)", marginTop: 2 }}>{motorWhy}</div> : null}
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
        {counts.inspect ? <b style={{ color: "#1657d6" }}>{counts.inspect} inspect</b> : null}
        <b className="vGood">{counts.done} up to date</b>
        <button className="btn tiny" style={{ marginLeft: "auto" }} onClick={print}>
          🖨 Print
        </button>
        {counts.due > 0 && (
          <button className="btn tiny primary" onClick={addAllDue}>
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
              <th className="r">Price</th>
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
                    {r.part && r.part.number ? (
                      <span className="sub muted">Part #{r.part.number} · {Number(r.part.onHand) || 0} in stock</span>
                    ) : null}
                    {r.status === "due" && r.lastDone && r.nextDueMiles ? (
                      <span className="sub muted">was due at {miles(r.nextDueMiles)}</span>
                    ) : r.status === "due" && !r.lastDone ? (
                      <span className="sub muted">no record on file</span>
                    ) : r.status === "soon" && r.nextDueMiles ? (
                      <span className="sub muted">due at {miles(r.nextDueMiles)}</span>
                    ) : null}
                  </td>
                  <td className="muted">
                    {r.basis === "inspect" ? (
                      "On inspection"
                    ) : (
                      <>
                        {miles(r.miles)}
                        {r.months ? ` / ${r.months} mo` : ""}
                        {mode !== "both" && motorState !== "store" ? (
                          r.source === "MOTOR" ? (
                            <span className="sub" style={{ color: "#1657d6" }}>Manufacturer</span>
                          ) : (
                            <span className="sub" style={{ color: "#92400e" }}>{storeLabel} recommendation</span>
                          )
                        ) : null}
                        {mode === "both" && r.motorMiles > 0 ? (
                          <span className="sub">
                            {storeLabel} {miles(r.storeMiles)} · <span style={{ color: "#1657d6" }}>Manufacturer {miles(r.motorMiles)}</span>
                          </span>
                        ) : null}
                        {r.motorInspectMiles > 0 || r.motorInspectMonths > 0 ? (
                          <span className="sub">
                            Maker says inspect every {r.motorInspectMiles ? miles(r.motorInspectMiles) : `${r.motorInspectMonths} mo`}
                          </span>
                        ) : null}

                      </>
                    )}
                  </td>
                  <td className="muted">{r.lastDone ? `${miles(r.lastDone.mileage)} · ${fmtDate(r.lastDone.at)}` : "—"}</td>
                  <td>
                    <span className={`svcBadge ${st.cls}`}>{st.label}</span>
                  </td>
                  <td className="r" style={{ fontVariantNumeric: "tabular-nums" }}>{r.effPrice ? fmtMoney(r.effPrice) : "—"}</td>
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
        {mode === "store"
          ? `Showing your ${storeLabel.toLowerCase()} recommendations (Settings → Service review).`
          : merged.source === "MOTOR"
            ? mode === "both"
              ? `Showing your ${storeLabel.toLowerCase()} recommendations and this vehicle's manufacturer schedule side by side; due/done uses the manufacturer number.`
              : "Manufacturer recommendations where available; the rest use your own (Settings → Service review)."
            : `${storeLabel} recommendations (Settings → Service review) — connect MOTOR for each vehicle's manufacturer schedule.`}{" "}
        "Done" is detected from this car's past tickets. Which services and source are set in Settings.
      </p>
    </Modal>
    {target ? createPortal(printNode, target) : printNode}
    </>
  );
}
