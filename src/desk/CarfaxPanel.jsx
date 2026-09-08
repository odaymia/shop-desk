import { useState } from "react";
import { Field, Text } from "./ui.jsx";
import { carfaxRows, carfaxFile, carfaxFileName } from "../lib/carfax.js";

/* Settings → CARFAX. Builds the service-history file CARFAX takes from
   partnered management systems. Nightly automatic delivery needs
   CARFAX's FTP credentials under a data agreement; until then the file
   can be downloaded and handed to them. */
export function CarfaxPanel({ cfg, shop, d, set, flash }) {
  const [range, setRange] = useState("night"); // night | month | all
  const [last, setLast] = useState(null);

  const build = () => {
    const now = Date.now();
    const since = range === "night" ? now - 36 * 3600 * 1000 : range === "month" ? now - 31 * 86400 * 1000 : 0;
    const rows = [];
    let invoices = 0;
    let noVin = 0;
    for (const o of Object.values(shop.orders)) {
      if (o.status !== "invoiced" || (o.invoicedAt || 0) < since) continue;
      const v = shop.vehicles[o.vehicleId];
      const r = carfaxRows(o, v, cfg);
      if (r.length) {
        rows.push(...r);
        invoices++;
      } else noVin++;
    }
    if (!rows.length) return flash("No posted invoices with a VIN in that range", "out");
    const name = carfaxFileName("ShopDesk", range === "all" ? "HIST" : "PROD");
    const blob = new Blob([carfaxFile(rows)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setLast({ name, invoices, rows: rows.length, noVin });
  };

  return (
    <>
      <h3 className="subhead" style={{ marginTop: 36 }}>
        CARFAX service history
      </h3>
      <p className="legalNote" style={{ marginTop: 0 }}>
        CARFAX adds your posted invoices to each car's history report: what was done, when, at what mileage. Never the
        customer's name or the price. Fill in the location ID CARFAX gives you when you join their Service Network, then
        use the file below until automatic nightly delivery is switched on.
      </p>
      <div className="fldRow">
        <Field label="CARFAX location ID">
          <Text value={d.carfaxLocationId || ""} onChange={(v) => set("carfaxLocationId")(v.trim())} placeholder="From CARFAX" />
        </Field>
        <Field label="Shop website (printed in the CARFAX record)">
          <Text value={d.shopWebsite || ""} onChange={(v) => set("shopWebsite")(v.trim())} placeholder="genieautocenter.com" />
        </Field>
      </div>
      <div className="rowBtns" style={{ alignItems: "center" }}>
        <div className="seg">
          <button className={range === "night" ? "on" : ""} onClick={() => setRange("night")}>
            Since yesterday
          </button>
          <button className={range === "month" ? "on" : ""} onClick={() => setRange("month")}>
            Last 30 days
          </button>
          <button className={range === "all" ? "on" : ""} onClick={() => setRange("all")}>
            Everything (one-time back file)
          </button>
        </div>
        <button className="btn" onClick={build}>
          Download CARFAX file
        </button>
      </div>
      {last && (
        <p className="muted" style={{ marginTop: 10 }}>
          {last.name}: {last.invoices.toLocaleString()} invoices, {last.rows.toLocaleString()} lines.
          {last.noVin ? ` ${last.noVin.toLocaleString()} invoices skipped for having no VIN on the car.` : ""}
        </p>
      )}
    </>
  );
}
