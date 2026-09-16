import { useEffect } from "react";
import { stickerData } from "../lib/sticker.js";
import { fmtPhone } from "./ui.jsx";

/* The oil-change reminder sticker for the windshield. Prints the vehicle, the
   next service date and mileage, and the oil used, with the Express Care mark
   and the shop's name and address. Auto-opens the print dialog when a ticket
   is posted; a label printer set to skip the dialog prints it straight away. */
export function Sticker({ order, cfg, vehicle, auto, onClose }) {
  const d = stickerData(order, cfg, vehicle);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    let t;
    if (auto) t = setTimeout(() => window.print(), 400);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(t);
    };
  }, [auto, onClose]);

  return (
    <div className="printSheet show">
      <style>{`@media print { @page { size: auto; margin: 0; } }`}</style>
      <div className="printBar">
        <button className="btn ghost" onClick={onClose}>
          Close
        </button>
        <button className="btn primary" onClick={() => window.print()}>
          Print sticker
        </button>
      </div>
      <div className="printWrap">
        <div className="stickerSheet">
          <div className="stFields">
            <div className="stRow">
              <span>VEHICLE ID</span>
              <b>{d.vehicleId || " "}</b>
            </div>
            <div className="stRow">
              <span>NEXT SERVICE DATE</span>
              <b>{d.nextDate}</b>
            </div>
            <div className="stRow">
              <span>NEXT SERVICE MILEAGE</span>
              <b>{d.nextMileage ? d.nextMileage.toLocaleString() : " "}</b>
            </div>
            <div className="stRow">
              <span>LAST OIL USED</span>
              <b>{d.lastOil || " "}</b>
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
}
