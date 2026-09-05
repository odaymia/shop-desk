import { useState, useEffect } from "react";
import { Field, Text, Num, toNum } from "./ui.jsx";
import { CloudSync } from "../components/CloudSync.jsx";

/* Shop info, pricing rules, what prints on the invoice, and the cloud
   account. */
export function DeskSettings({ cfg, saveCfg, flash }) {
  const [d, setD] = useState(cfg);
  useEffect(() => setD(cfg), [cfg]);
  const set = (k) => (v) => setD((x) => ({ ...x, [k]: v }));
  const onOff = (k, onText, offText) => (
    <select value={d[k] ? "on" : "off"} onChange={(e) => set(k)(e.target.value === "on")}>
      <option value="on">{onText}</option>
      <option value="off">{offText}</option>
    </select>
  );
  const save = async () => {
    await saveCfg({
      ...d,
      laborRate: toNum(d.laborRate),
      taxRate: toNum(d.taxRate),
      suppliesPct: toNum(d.suppliesPct),
      suppliesCap: toNum(d.suppliesCap),
      nextOrderNumber: Math.max(1, Math.floor(toNum(d.nextOrderNumber)) || 1001),
    });
    flash("Settings saved");
  };
  return (
    <>
      <header className="deskHead">
        <h1>Front desk settings</h1>
      </header>
      <div className="deskBody">
        <div className="settingsGrid">
          <h3 className="subhead">On the invoice header</h3>
          <Field label="Shop name">
            <Text value={d.shopName} onChange={set("shopName")} />
          </Field>
          <Field label="Address">
            <Text value={d.shopAddress} onChange={set("shopAddress")} placeholder="1234 Main St, San Diego, CA 92101" />
          </Field>
          <div className="fldRow">
            <Field label="Phone">
              <Text value={d.shopPhone} onChange={set("shopPhone")} inputMode="tel" />
            </Field>
            <Field label="Email">
              <Text value={d.shopEmail} onChange={set("shopEmail")} type="email" />
            </Field>
          </div>

          <h3 className="subhead">Pricing</h3>
          <div className="fldRow">
            <Field label="Labor rate ($/hour)">
              <Num value={d.laborRate} onChange={set("laborRate")} />
            </Field>
            <Field label="Sales tax rate (%)">
              <Num value={d.taxRate} onChange={set("taxRate")} />
            </Field>
          </div>
          <Field label="Parts">{onOff("partsTaxable", "Taxable", "Not taxable")}</Field>
          <Field label="Labor">{onOff("laborTaxable", "Taxable", "Not taxable (California)")}</Field>
          <Field label="Sublet work">{onOff("subletTaxable", "Taxable", "Not taxable")}</Field>
          <div className="fldRow">
            <Field label="Shop supplies (% of labor)">
              <Num value={d.suppliesPct} onChange={set("suppliesPct")} />
            </Field>
            <Field label="Supplies cap per ticket ($, 0 = none)">
              <Num value={d.suppliesCap} onChange={set("suppliesCap")} />
            </Field>
          </div>
          <Field label="Shop supplies charge">{onOff("suppliesTaxable", "Taxable", "Not taxable")}</Field>
          <Field label="First ticket number (only matters before the first ticket)">
            <Num value={d.nextOrderNumber} onChange={set("nextOrderNumber")} />
          </Field>
          <Field label="Week starts on (for the This week report)">
            <select value={d.weekStart} onChange={(e) => set("weekStart")(Number(e.target.value))}>
              {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((n, i) => (
                <option key={n} value={i}>
                  {n}
                </option>
              ))}
            </select>
          </Field>

          <h3 className="subhead">Printed text</h3>
          <Field label="Authorization line (estimates and repair orders)">
            <textarea className="ta" value={d.authorizationText} onChange={(e) => set("authorizationText")(e.target.value)} />
          </Field>
          <Field label="Invoice footer (warranty, thank-you)">
            <textarea className="ta" value={d.invoiceFooter} onChange={(e) => set("invoiceFooter")(e.target.value)} />
          </Field>
          <button className="btn primary lg" onClick={save}>
            Save settings
          </button>

          <h3 className="subhead" style={{ marginTop: 36 }}>
            Cloud account
          </h3>
          <CloudSync />
          <p className="legalNote">
            Posting an invoice freezes the tax rate and supplies rule on that ticket. Changing them here affects new
            tickets and open estimates only.
          </p>
        </div>
      </div>
    </>
  );
}
