import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { stickerData, currentMileage, reminderMonthsFor, reminderMilesFor } from "../lib/sticker.js";
import { Modal, Field, fmtPhone } from "./ui.jsx";

/* The printed label itself — used both for the on-screen preview and for
   the hidden sheet that actually prints. */
function StickerLabel({ d, cfg }) {
  return (
    <div className="stickerSheet">
      <div className="stFields">
        <div className="stRow">
          <span>VEHICLE ID</span>
          <b>{d.vehicleId || " "}</b>
        </div>
        <div className="stRow">
          <span>NEXT SERVICE DATE</span>
          <b>{d.nextDate}</b>
        </div>
        <div className="stRow">
          <span>NEXT SERVICE MILEAGE</span>
          <b>{d.nextMileage ? d.nextMileage.toLocaleString() : " "}</b>
        </div>
        <div className="stRow">
          <span>LAST OIL USED</span>
          <b>{d.lastOil || " "}</b>
        </div>
      </div>
      <div className="stFoot">
        <div className="stBrand">
          <span className="stPow">POWERED BY</span>
          <strong className="stEc">EXPRESS CARE</strong>
          <span className="stVal">Valvoline.</span>
        </div>
        <div className="stShop">
          <strong>{cfg.shopName}</strong>
          {cfg.shopAddress ? <span>{cfg.shopAddress}</span> : null}
          {cfg.shopPhone ? <span>{fmtPhone(cfg.shopPhone)}</span> : null}
        </div>
      </div>
    </div>
  );
}

/* The oil-change reminder sticker, as a popup over the ticket. It records
   who worked on the car (required on oil changes), asks for the mileage
   when the ticket has none, and sets how far out the next service is —
   defaulting to whatever this vehicle used last, or 3 months / 3,000 mi.
   Print puts the label out on its own sheet; onSave remembers the interval
   on the car and onAssign records the crew on the ticket. */
export function Sticker({ order, cfg, vehicle, employees, requireCrew, onAssign, onClose, onSave }) {
  const known = currentMileage(order);
  const [mileage, setMileage] = useState(known ? String(known) : "");
  const [months, setMonths] = useState(String(reminderMonthsFor(vehicle, cfg)));
  const [miles, setMiles] = useState(String(reminderMilesFor(vehicle, cfg)));
  const [advisor, setAdvisor] = useState(order.advisorId || order.writerId || "");
  const [top, setTop] = useState(order.topTechId || order.techId || "");
  const [pit, setPit] = useState(order.pitTechId || "");

  const d = stickerData(order, cfg, vehicle, { months, miles, mileage });
  const crewOk = !requireCrew || (advisor && top && pit);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const assign = (patch, setter, v) => {
    setter(v);
    if (onAssign) onAssign(patch);
  };
  const print = () => {
    if (!crewOk) return;
    if (onSave) onSave({ months: d.months, miles: d.miles, mileage: d.mileage || null });
    window.print();
  };

  const crewSelect = (value, onPick) => (
    <select value={value} onChange={(e) => onPick(e.target.value)}>
      <option value="">—</option>
      {(employees || []).map((e) => (
        <option key={e.id} value={e.id}>
          {e.name}
        </option>
      ))}
    </select>
  );

  const target = (typeof document !== "undefined" && (document.querySelector(".root") || document.body)) || null;
  const printNode = (
    <div className="printSheet">
      <style>{`@media print { @page { size: auto; margin: 0; } }`}</style>
      <div className="printWrap">
        <StickerLabel d={d} cfg={cfg} />
      </div>
    </div>
  );

  return (
    <>
      <Modal title="Oil-change reminder sticker" onClose={onClose} size="wide">
        <div className="stkSect">
          <div className="stkSectHead">
            Who worked on this car{requireCrew ? <span className="req"> · required</span> : null}
          </div>
          <div className="stkGrid3">
            <Field label="Advisor (write-up)">{crewSelect(advisor, (v) => assign({ advisorId: v || null, writerId: v || null }, setAdvisor, v))}</Field>
            <Field label="Top tech (hood)">{crewSelect(top, (v) => assign({ topTechId: v || null, techId: v || null }, setTop, v))}</Field>
            <Field label="Pit tech (under car)">{crewSelect(pit, (v) => assign({ pitTechId: v || null }, setPit, v))}</Field>
          </div>
        </div>

        <div className="stkSect">
          <div className="stkSectHead">Next service reminder</div>
          <div className="stkGrid3">
            <Field label="Current mileage">
              <input className={!d.mileage ? "need" : ""} inputMode="numeric" value={mileage} onChange={(e) => setMileage(e.target.value)} placeholder="odometer" autoFocus={!known} />
            </Field>
            <Field label="Next service in (months)">
              <input inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} />
            </Field>
            <Field label="Next service in (miles)">
              <input inputMode="numeric" value={miles} onChange={(e) => setMiles(e.target.value)} />
            </Field>
          </div>
          <p className="stCalc">
            Next service: <b>{d.nextDate}</b>
            {d.nextMileage ? (
              <>
                {" · "}
                <b>{d.nextMileage.toLocaleString()} mi</b>
              </>
            ) : (
              <span className="muted"> · enter mileage for the next-service mileage</span>
            )}
            <span className="muted"> — saved on this vehicle for next time.</span>
          </p>
        </div>

        <div className="stkPreview">
          <StickerLabel d={d} cfg={cfg} />
        </div>

        {requireCrew && !crewOk && <p className="fldErr">Select the advisor, top tech, and pit tech — required on oil changes.</p>}
        <div className="rowBtns">
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
          <button className="btn primary" onClick={print} disabled={!crewOk} title={crewOk ? "" : "Assign the crew first"}>
            Print sticker
          </button>
        </div>
      </Modal>
      {target ? createPortal(printNode, target) : printNode}
    </>
  );
}
