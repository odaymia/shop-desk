import { useState, useEffect } from "react";
import { Field, Text, Num, toNum } from "./ui.jsx";
import { CloudSync } from "../components/CloudSync.jsx";
import defaultLogo from "../assets/genie-logo.png";
import { PLATE_PROVIDER } from "../lib/plate.js";
import { ImportPanel } from "./Import.jsx";
import { NAME_MODES } from "../lib/names.js";

/* Shrink an uploaded image to something that fits in a settings record
   and prints crisply: at most 900px wide, PNG so transparency survives. */
function readLogo(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 900 / img.width);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL("image/png"));
    };
    img.onerror = () => rej(new Error("That file isn't an image the browser can read."));
    img.src = url;
  });
}

/* Shop info, pricing rules, what prints on the invoice, and the cloud
   account. */
export function DeskSettings({ cfg, saveCfg, flash, roster, saveRoster }) {
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
          <div className="fld">
            <span>Logo (shown in the menu and printed on tickets)</span>
            <div className="logoPreview">
              <img src={d.logo || defaultLogo} alt="" />
              <div className="rowBtns">
                <label className="btn tiny">
                  Upload
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={async (e) => {
                      const f = e.target.files && e.target.files[0];
                      if (!f) return;
                      try {
                        set("logo")(await readLogo(f));
                      } catch (err) {
                        flash(err.message, "out");
                      }
                    }}
                  />
                </label>
                {d.logo && (
                  <button className="btn tiny" onClick={() => set("logo")("")}>
                    Use the default
                  </button>
                )}
              </div>
            </div>
          </div>
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
          <Field label="BAR registration number (ARD)">
            <Text value={d.ardNumber || ""} onChange={set("ardNumber")} placeholder="ARD00123456" />
          </Field>
          <p className="legalNote" style={{ marginTop: -6, marginBottom: 18 }}>
            California requires the shop's Automotive Repair Dealer number, name, and address on every invoice. It prints in
            the header once it's filled in.
          </p>

          <h3 className="subhead">Plate lookup</h3>
          <Field label={`${PLATE_PROVIDER.name} API key`}>
            <Text value={d.plateApiKey || ""} onChange={set("plateApiKey")} type="password" placeholder="sk_live_…" autoComplete="off" />
          </Field>
          <p className="legalNote" style={{ marginTop: -6, marginBottom: 18 }}>
            Typing a plate and tapping “Look up plate” on a vehicle finds the VIN and fills in year, make, model, and
            engine. DMV records aren't public, so this goes through {PLATE_PROVIDER.name} at about{" "}
            {PLATE_PROVIDER.costText}, billed to a prepaid balance on your own account. Sign up at{" "}
            <a href={PLATE_PROVIDER.signup} target="_blank" rel="noreferrer">
              {PLATE_PROVIDER.signup.replace("https://", "")}
            </a>
            , add a few dollars, and paste the key here. The key is kept with your shop settings and only computers
            signed in to this shop can see it.
          </p>

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
          {toNum(d.suppliesPct) > 0 && (
            <div className="warnBox" style={{ marginBottom: 16 }}>
              A generic "shop supplies" charge is prohibited on California invoices (16 CCR 3356). Leave this at 0 and put
              real materials on the ticket as parts, described and priced.
            </div>
          )}
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

          <Field label="Staff names on printed tickets (writer and technician)">
            <select value={d.printStaffNames || "full"} onChange={(e) => set("printStaffNames")(e.target.value)}>
              {NAME_MODES.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
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
          <ImportPanel roster={roster} saveRoster={saveRoster} flash={flash} />
          <p className="legalNote">
            Posting an invoice freezes the tax rate and supplies rule on that ticket. Changing them here affects new
            tickets and open estimates only.
          </p>
        </div>
      </div>
    </>
  );
}
