import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { stickerData, currentMileage, reminderMonthsFor, reminderMilesFor } from "../lib/sticker.js";
import { fmtPhone } from "./ui.jsx";

/* The oil-change reminder sticker for the windshield. A quick review screen
   first: it asks for the mileage when the ticket doesn't have one, and lets
   the tech set how far out the next service is (months and miles), defaulting
   to whatever was last used for this car — or 3 months / 3,000 miles. Print
   then puts the vehicle, the next service date and mileage, and the oil used
   on the label, with the Express Care mark and the shop's name and address.
   onSave remembers the interval on the car for next time. */
export function Sticker({ order, cfg, vehicle, onClose, onSave }) {
  const known = currentMileage(order, vehicle);
  const [mileage, setMileage] = useState(known ? String(known) : "");
  const [months, setMonths] = useState(String(reminderMonthsFor(vehicle, cfg)));
  const [miles, setMiles] = useState(String(reminderMilesFor(vehicle, cfg)));

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const d = stickerData(order, cfg, vehicle, { months, miles, mileage });
  const vname = vehicle ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") : "";

  const print = () => {
    if (onSave) onSave({ months: d.months, miles: d.miles, mileage: d.mileage || null });
    window.print();
  };

  /* Render as a direct child of .root (where the receipt print lives) so the
     print rules that hide everything else don't hide the sticker too. */
  const target = (typeof document !== "undefined" && (document.querySelector(".root") || document.body)) || null;
  const node = (
    <div className="printSheet show">
      <style>{`@media print { @page { size: auto; margin: 0; } }`}</style>
      <div className="printBar">
        <button className="btn ghost" onClick={onClose}>
          Close
        </button>
        <button className="btn primary" onClick={print}>
          Print sticker
        </button>
      </div>
      <div className="printWrap">
        <div className="stickerForm">
          <h3>Reminder sticker{vname ? ` — ${vname}` : ""}</h3>
          <label className={`stFld${!d.mileage ? " need" : ""}`}>
            <span>Current mileage{!d.mileage ? " — enter to set the next-service mileage" : ""}</span>
            <input inputMode="numeric" value={mileage} onChange={(e) => setMileage(e.target.value)} placeholder="odometer reading" autoFocus={!known} />
          </label>
          <div className="stFldRow">
            <label className="stFld">
              <span>Next service in (months)</span>
              <input inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} />
            </label>
            <label className="stFld">
              <span>Next service in (miles)</span>
              <input inputMode="numeric" value={miles} onChange={(e) => setMiles(e.target.value)} />
            </label>
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
          </p>
          <p className="stNote muted">Saved on this vehicle — its next visit starts from these numbers.</p>
        </div>
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
      </div>
    </div>
  );
  return target ? createPortal(node, target) : node;
}
