import { useState, useEffect } from "react";
import { Field, Text, Num, toNum } from "./ui.jsx";
import { CloudSync } from "../components/CloudSync.jsx";
import defaultLogo from "../assets/genie-logo.png";
import { PLATE_PROVIDER } from "../lib/plate.js";
import { ImportPanel } from "./Import.jsx";
import { CarfaxPanel } from "./CarfaxPanel.jsx";
import { CATALOGS } from "../lib/parts.js";
import { NAME_MODES } from "../lib/names.js";
import { DEFAULT_CHECKLIST, normalizeChecklist } from "../lib/checklist.js";

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
const portalUrl = () => new URL("portal/", window.location.href).toString();

export function DeskSettings({ cfg, saveCfg, flash, roster, saveRoster, shop }) {
  const [d, setD] = useState(cfg);
  useEffect(() => setD(cfg), [cfg]);
  const set = (k) => (v) => setD((x) => ({ ...x, [k]: v }));
  const setCk = (i, patch) => setD((x) => ({ ...x, checklist: (x.checklist || []).map((p, k) => (k === i ? { ...p, ...patch } : p)) }));
  const setPkg = (i, patch) => setD((x) => ({ ...x, oilPackages: (x.oilPackages || []).map((p, k) => (k === i ? { ...p, ...patch } : p)) }));
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
      partsMarkupPct: toNum(d.partsMarkupPct),
      oilChangeLaborPrice: toNum(d.oilChangeLaborPrice),
      oilPackages: (d.oilPackages || [])
        .filter((p) => String(p.name || "").trim())
        .map((p) => ({ ...p, name: p.name.trim(), price: toNum(p.price), quarts: toNum(p.quarts) || 5, extraQuart: toNum(p.extraQuart) })),
      checklist: normalizeChecklist(d.checklist),
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
          <Field label="Oil change labor, flat ($, 0 = add your own labor line)">
            <Num value={d.oilChangeLaborPrice} onChange={set("oilChangeLaborPrice")} />
          </Field>
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

          <h3 className="subhead">Oil change menu</h3>
          <p className="legalNote" style={{ marginTop: 0 }}>
            What the Oil change button on a ticket offers. Each package includes the quarts shown, the filter, and a fluid
            check; quarts past that are charged per quart. The package price is charged plus tax.
          </p>
          <div className="miniLines">
            {(d.oilPackages || []).map((p, i) => (
              <div key={p.id || i} className="miniLine" style={{ gridTemplateColumns: "2fr 90px 70px 90px 36px" }}>
                <input value={p.name} onChange={(e) => setPkg(i, { name: e.target.value })} placeholder="Valvoline Full Synthetic Oil Change" />
                <input inputMode="decimal" value={p.price} onChange={(e) => setPkg(i, { price: e.target.value })} placeholder="Price" title="Package price" />
                <input inputMode="decimal" value={p.quarts} onChange={(e) => setPkg(i, { quarts: e.target.value })} placeholder="Qt" title="Quarts included" />
                <input inputMode="decimal" value={p.extraQuart} onChange={(e) => setPkg(i, { extraQuart: e.target.value })} placeholder="$/qt over" title="Per quart past the included amount" />
                <button className="lineX" onClick={() => set("oilPackages")(d.oilPackages.filter((_, k) => k !== i))} aria-label="Remove">
                  ✕
                </button>
                <textarea
                  className="ta"
                  style={{ gridColumn: "1 / -1", minHeight: 44 }}
                  value={p.details || ""}
                  onChange={(e) => setPkg(i, { details: e.target.value })}
                  placeholder="What's included (prints under the line)"
                />
              </div>
            ))}
          </div>
          <div className="addBar">
            <button className="btn tiny" onClick={() => set("oilPackages")([...(d.oilPackages || []), { id: "pkg" + Date.now().toString(36), name: "", price: "", quarts: 5, extraQuart: "", details: "" }])}>
              + Package
            </button>
          </div>

          <h3 className="subhead">Service checklist</h3>
          <p className="legalNote" style={{ marginTop: 0 }}>
            The walk-around that prints on the invoice. It opens on its own when an oil change goes on a ticket and runs
            from the keyboard: Enter takes the answer, Space picks a different one. An item whose part or service is on
            the ticket starts at Replaced; the words that mean that go in the last box ("oil filter", or "air filter
            -cabin" to leave the cabin filter out, alternatives split with |).
          </p>
          <Field label="When an oil change goes on a ticket">
            {onOff("checklistOnOil", "Open the checklist right away", "Wait for the Checklist button")}
          </Field>
          <div className="miniLines">
            {(d.checklist || []).map((it, i) => (
              <div key={it.id || i} className="miniLine" style={{ gridTemplateColumns: "1.4fr 110px 2fr 1fr 1fr 36px" }}>
                <input value={it.label || ""} onChange={(e) => setCk(i, { label: e.target.value })} placeholder="Engine oil" />
                <select value={it.kind || "choice"} onChange={(e) => setCk(i, { kind: e.target.value })} title="How it's answered">
                  <option value="choice">Choices</option>
                  <option value="text">Typed</option>
                  <option value="depth">Tire depth</option>
                </select>
                <input
                  value={Array.isArray(it.options) ? it.options.join(", ") : it.options || ""}
                  onChange={(e) => setCk(i, { options: e.target.value })}
                  placeholder={(it.kind || "choice") === "choice" ? "Checked OK, Added, Replaced" : ""}
                  title="Choices, comma separated"
                  disabled={(it.kind || "choice") !== "choice"}
                />
                <input value={it.value || ""} onChange={(e) => setCk(i, { value: e.target.value })} placeholder="Starts at" title="What it starts at" />
                <input
                  value={it.auto || ""}
                  onChange={(e) => setCk(i, { auto: e.target.value })}
                  placeholder="Replaced when the ticket has…"
                  title="Words on a ticket line that mean this was replaced"
                  disabled={(it.kind || "choice") !== "choice"}
                />
                <button className="lineX" onClick={() => set("checklist")(d.checklist.filter((_, k) => k !== i))} aria-label="Remove">
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div className="addBar">
            <button className="btn tiny" onClick={() => set("checklist")([...(d.checklist || []), { id: "ck" + Date.now().toString(36), label: "", kind: "choice", options: "", value: "", auto: "" }])}>
              + Item
            </button>
            <button className="btn tiny ghost" onClick={() => set("checklist")(DEFAULT_CHECKLIST)}>
              Reset to the standard list
            </button>
          </div>

          <h3 className="subhead">Printed text</h3>
          <Field label="Authorization line (estimates and repair orders)">
            <textarea className="ta" value={d.authorizationText} onChange={(e) => set("authorizationText")(e.target.value)} />
          </Field>
          <Field label="Invoice footer (warranty, thank-you)">
            <textarea className="ta" value={d.invoiceFooter} onChange={(e) => set("invoiceFooter")(e.target.value)} />
          </Field>
          <h3 className="subhead" style={{ marginTop: 36 }}>
            Parts catalogs
          </h3>
          <p className="legalNote" style={{ marginTop: 0 }}>
            Each catalog you tick gets a button on the ticket. It opens in a new tab with the car's VIN copied, ready to
            paste. Parts you pick there are typed onto the ticket by hand until PartsTech ordering is switched on below.
          </p>
          {CATALOGS.map(([k, label]) => (
            <label key={k} className="fld inline">
              <input
                type="checkbox"
                checked={!!(d.catalogs && d.catalogs[k])}
                onChange={(e) => set("catalogs")({ ...(d.catalogs || {}), [k]: e.target.checked })}
              />
              <span>{label}</span>
            </label>
          ))}
          <div className="fldRow">
            <Field label="Parts markup over cost (%)">
              <Num value={d.partsMarkupPct} onChange={set("partsMarkupPct")} />
            </Field>
            <Field label="Round sell prices to .99">
              <select value={d.partsPriceEnding99 ? "on" : "off"} onChange={(e) => set("partsPriceEnding99")(e.target.value === "on")}>
                <option value="off">No, exact markup</option>
                <option value="on">Yes, end in .99</option>
              </select>
            </Field>
          </div>
          <p className="legalNote" style={{ marginTop: 0 }}>
            Used for parts that come back from a catalog. A part whose list price is higher than cost plus markup sells at
            list.
          </p>
          <div className="fldRow">
            <Field label="PartsTech login (email)">
              <Text value={d.partsTechUser || ""} onChange={set("partsTechUser")} placeholder="you@shop.com" />
            </Field>
            <Field label="PartsTech API key">
              <input type="password" value={d.partsTechKey || ""} onChange={(e) => set("partsTechKey")(e.target.value.trim())} placeholder="From PartsTech → My Account → API" />
            </Field>
          </div>
          <p className="legalNote" style={{ marginTop: 0 }}>
            With a free PartsTech shop account linked to your O'Reilly First Call login, parts ordering inside the ticket
            becomes possible once PartsTech issues Shop Desk a partner key. Your login and key are saved here so it's a
            one-step switch-on when that arrives.
          </p>

          <h3 className="subhead" style={{ marginTop: 36 }}>
            Customer portal
          </h3>
          <p className="legalNote" style={{ marginTop: 0 }}>
            Customers sign in with a link sent to their email and see their cars, what's due, their service history, and
            the prices you choose to show. Only customers with an email on their record can sign in, and each one sees only
            their own cars. Needs the portal tables from supabase/portal.sql, and the portal address added under
            Authentication → URL Configuration in Supabase.
          </p>
          <Field label="Customer portal">
            <select value={d.portalEnabled ? "on" : "off"} onChange={(e) => set("portalEnabled")(e.target.value === "on")}>
              <option value="off">Off</option>
              <option value="on">On — publish customer records as invoices post</option>
            </select>
          </Field>
          <Field label="Hours (shown on the portal)">
            <Text value={d.hours || ""} onChange={set("hours")} placeholder="Mon–Fri 8–6, Sat 8–2" />
          </Field>
          <div className="rowBtns" style={{ alignItems: "center" }}>
            <a className="btn" href={portalUrl()} target="_blank" rel="noreferrer">
              Open the portal ↗
            </a>
            <button
              className="btn"
              disabled={!cfg.portalEnabled || !shop}
              title={!cfg.portalEnabled ? "Turn the portal on and save first" : ""}
              onClick={async () => {
                const n = await shop.publishAll();
                flash(`${n} customers queued for the portal`);
              }}
            >
              Publish every customer now
            </button>
          </div>
          <p className="legalNote" style={{ marginTop: 6 }}>
            Prices on the portal come from canned jobs ticked "Show on the customer portal." Give customers the link:{" "}
            {portalUrl()}
          </p>

          <CarfaxPanel cfg={cfg} shop={shop} d={d} set={set} flash={flash} />

          <button className="btn primary lg" onClick={save} style={{ marginTop: 18 }}>
            Save settings
          </button>

          <h3 className="subhead" style={{ marginTop: 36 }}>
            Cloud account
          </h3>
          <CloudSync />
          <ImportPanel roster={roster} saveRoster={saveRoster} flash={flash} shop={shop} />
          <p className="legalNote">
            Posting an invoice freezes the tax rate and supplies rule on that ticket. Changing them here affects new
            tickets and open estimates only.
          </p>
        </div>
      </div>
    </>
  );
}
