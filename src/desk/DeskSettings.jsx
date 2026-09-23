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
import { COMM_ROLES, commToForm, commFromForm } from "../lib/commission.js";
import { DEFAULT_SERVICE_MENU, normalizeMenu } from "../lib/services.js";
import { DEFAULT_SERVICE_INTERVALS, normalizeServiceIntervals } from "../lib/serviceReview.js";
import { DEFAULT_SYMPTOMS, DEFAULT_SYMPTOMS_MAP } from "../lib/symptoms.js";
import { FINDINGS_BY_CATEGORY } from "../lib/findings.js";
import { sGetAll, sSet, cloud } from "../storage/index.js";
import { connectStatus, connectLink, listReaders, registerReader, platformFeeCfg, cardPaymentStats } from "../lib/payments.js";
import { serviceRows, serviceFileText, serviceFileName, loyaltyRows, loyaltyFileText, loyaltyFileName } from "../lib/carfaxExport.js";
import { fmtMoney } from "../lib/invoice.js";
import { DEMO } from "../lib/demo.js";

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

/* Trim a per-category override map, dropping empty items and any category
   whose list is empty (so it falls back to the built-in list). */
function normalizeByCat(map) {
  const out = {};
  for (const [cat, list] of Object.entries(map || {})) {
    const items = (Array.isArray(list) ? list : []).map((s) => String(s || "").trim()).filter(Boolean);
    if (items.length) out[cat] = items;
  }
  return out;
}

const SETTINGS_SECTIONS = [
  ["company", "Company info"],
  ["customers", "Customers"],
  ["pricing", "Pricing & parts"],
  ["menus", "Service menu"],
  ["builder", "Symptom & fix lists"],
  ["oilchange", "Oil change"],
  ["commissions", "Commissions"],
  ["servicereview", "Service review"],
  ["payments", "Payments"],
  ["data", "Data & backup"],
];

export function DeskSettings({ cfg, saveCfg, flash, roster, saveRoster, shop }) {
  const [d, setD] = useState(cfg);
  const [section, setSection] = useState("company");
  const show = (id) => section === id;
  useEffect(() => setD(cfg), [cfg]);
  const set = (k) => (v) => setD((x) => ({ ...x, [k]: v }));
  const setMenu = (i, patch) => setD((x) => ({ ...x, serviceMenu: (x.serviceMenu || []).map((p, k) => (k === i ? { ...p, ...patch } : p)) }));
  const moveMenu = (i, dir) =>
    setD((x) => {
      const m = [...(x.serviceMenu || [])];
      const j = i + dir;
      if (j < 0 || j >= m.length) return x;
      [m[i], m[j]] = [m[j], m[i]];
      return { ...x, serviceMenu: m };
    });
  const setCk = (i, patch) => setD((x) => ({ ...x, checklist: (x.checklist || []).map((p, k) => (k === i ? { ...p, ...patch } : p)) }));
  const setPkg = (i, patch) => setD((x) => ({ ...x, oilPackages: (x.oilPackages || []).map((p, k) => (k === i ? { ...p, ...patch } : p)) }));
  /* Service review interval table */
  const svcRows = () => (d.serviceIntervals && d.serviceIntervals.length ? d.serviceIntervals : DEFAULT_SERVICE_INTERVALS);
  const setSvc = (i, patch) => setD((x) => ({ ...x, serviceIntervals: svcRows().map((r, k) => (k === i ? { ...r, ...patch } : r)) }));
  const addSvc = () => setD((x) => ({ ...x, serviceIntervals: [...svcRows(), { id: "svc" + Date.now(), name: "", miles: 30000, months: 24, price: 0, match: "", motorKeys: [], enabled: true }] }));
  const removeSvc = (i) => setD((x) => ({ ...x, serviceIntervals: svcRows().filter((_, k) => k !== i) }));
  /* Editable symptom / findings lists per category (Settings → Symptom & fix
     lists). The effective list is the shop's override or the built-in. */
  const [builderCat, setBuilderCat] = useState(DEFAULT_SYMPTOMS[0][0]);
  const builtinFor = (mapKey, cat) => (mapKey === "symptomsByCat" ? DEFAULT_SYMPTOMS_MAP[cat] : FINDINGS_BY_CATEGORY[cat]) || [];
  const effList = (x, mapKey, cat) => {
    const over = x[mapKey] && x[mapKey][cat];
    return Array.isArray(over) ? over : builtinFor(mapKey, cat);
  };
  const listFor = (mapKey) => effList(d, mapKey, builderCat);
  const setBuilderList = (mapKey, cat, fn) => setD((x) => ({ ...x, [mapKey]: { ...(x[mapKey] || {}), [cat]: fn(effList(x, mapKey, cat)) } }));
  const editBuilderItem = (mapKey, cat, i, v) => setBuilderList(mapKey, cat, (l) => l.map((it, k) => (k === i ? v : it)));
  const addBuilderItem = (mapKey, cat) => setBuilderList(mapKey, cat, (l) => [...l, ""]);
  const removeBuilderItem = (mapKey, cat, i) => setBuilderList(mapKey, cat, (l) => l.filter((_, k) => k !== i));
  const resetBuilderCat = (mapKey, cat) =>
    setD((x) => {
      const m = { ...(x[mapKey] || {}) };
      delete m[cat];
      return { ...x, [mapKey]: m };
    });

  const split = (d.commission && d.commission.split) || { advisor: 40, top: 30, pit: 30 };
  const setSplit = (role, v) => setD((x) => ({ ...x, commission: { ...(x.commission || {}), split: { ...split, [role]: v } } }));
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
        .map((p) => ({ ...p, name: p.name.trim(), price: toNum(p.price), quarts: toNum(p.quarts) || 5, extraQuart: toNum(p.extraQuart), commission: commFromForm(p.commission) })),
      checklist: normalizeChecklist(d.checklist),
      serviceMenu: normalizeMenu(d.serviceMenu),
      serviceIntervals: normalizeServiceIntervals(d.serviceIntervals && d.serviceIntervals.length ? d.serviceIntervals : DEFAULT_SERVICE_INTERVALS),
      bays: (d.bays || [])
        .filter((b) => String(b.name || "").trim())
        .map((b, i) => ({ id: b.id || "bay" + (i + 1), name: String(b.name).trim() })),
      symptomsByCat: normalizeByCat(d.symptomsByCat),
      findingsByCat: normalizeByCat(d.findingsByCat),
      nextOrderNumber: Math.max(1, Math.floor(toNum(d.nextOrderNumber)) || 1001),
      commission: { ...(d.commission || {}), split: { advisor: toNum(split.advisor), top: toNum(split.top), pit: toNum(split.pit) } },
      reminderMonths: Math.max(0, Math.floor(toNum(d.reminderMonths)) || 3),
      reminderMiles: Math.max(0, Math.floor(toNum(d.reminderMiles)) || 3000),
    });
    flash("Settings saved");
  };
  return (
    <>
      <header className="deskHead">
        <h1>Front desk settings</h1>
      </header>
      <div className="deskBody">
        <nav className="settingsNav">
          {SETTINGS_SECTIONS.map(([id, label]) => (
            <button key={id} className={section === id ? "on" : ""} onClick={() => setSection(id)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="settingsGrid">
          {show("company") && (
          <>
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
          <Field label="EPA ID number (hazardous waste)">
            <Text value={d.epaId || ""} onChange={set("epaId")} placeholder="CAL000123456" />
          </Field>
          <p className="legalNote" style={{ marginTop: -6, marginBottom: 18 }}>
            Only needed if you charge a hazardous-waste / disposal fee — BAR requires the fee to print with your EPA ID number. It fills in
            automatically on any disposal fee line.
          </p>
          <p className="legalNote" style={{ marginTop: -6, marginBottom: 18 }}>
            California requires the shop's Automotive Repair Dealer number, name, and address on every invoice. It prints in
            the header once it's filled in.
          </p>

          </>
          )}
          {show("customers") && (
          <>
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

          <h3 className="subhead">Customers</h3>
          <Field label="Customer names">
            {onOff("requireRealName", "Must be a real name", "Allow anything")}
          </Field>
          <p className="legalNote" style={{ marginTop: -6, marginBottom: 18 }}>
            When on, a customer's name has to be actual letters — the desk won't save a placeholder like “.”, “,”, or a
            number in the name. A walk-in with no customer is still fine; this only checks a name once one is typed.
          </p>

          </>
          )}
          {show("pricing") && (
          <>
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

          </>
          )}
          {show("menus") && (
          <>
          <h3 className="subhead">Service menu</h3>
          <p className="legalNote" style={{ marginTop: 0 }}>
            The buttons on a ticket, in this order. Oil change opens the oil change packages below; every other
            button opens the canned jobs filed under its category. Red for the big three, green for the rest.
          </p>
          <div className="miniLines">
            {(d.serviceMenu || []).map((m, i) => (
              <div key={m.id || i} className="miniLine" style={{ gridTemplateColumns: "1fr 1.4fr 90px 30px 30px 36px" }}>
                <input value={m.name || ""} onChange={(e) => setMenu(i, { name: e.target.value })} placeholder="Button" />
                {m.oil ? (
                  <span className="muted" style={{ fontSize: 13 }}>
                    Opens the oil change packages
                  </span>
                ) : (
                  <input value={m.category || ""} onChange={(e) => setMenu(i, { category: e.target.value })} placeholder="Canned job category" title="Jobs with this category show under the button" />
                )}
                <select value={m.color === "green" ? "green" : "red"} onChange={(e) => setMenu(i, { color: e.target.value })}>
                  <option value="red">Red</option>
                  <option value="green">Green</option>
                </select>
                <button className="lineX" onClick={() => moveMenu(i, -1)} aria-label="Move up" title="Move up">
                  ↑
                </button>
                <button className="lineX" onClick={() => moveMenu(i, 1)} aria-label="Move down" title="Move down">
                  ↓
                </button>
                <button className="lineX" onClick={() => set("serviceMenu")(d.serviceMenu.filter((_, k) => k !== i))} aria-label="Remove">
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div className="addBar">
            <button className="btn tiny" onClick={() => set("serviceMenu")([...(d.serviceMenu || []), { id: "svc" + Date.now().toString(36), name: "", category: "", color: "green" }])}>
              + Button
            </button>
            <button className="btn tiny ghost" onClick={() => set("serviceMenu")(DEFAULT_SERVICE_MENU)}>
              Reset to the standard menu
            </button>
          </div>

          </>
          )}
          {show("builder") && (
          <>
          <h3 className="subhead">Symptom & fix builder lists</h3>
          <p className="legalNote" style={{ marginTop: 0 }}>
            Tailor the concern and fix builders. Pick a category, then add your own, reword, or remove any item — keep it in plain,
            everyday language so it prints clearly. Reset a category to the built-in list anytime.
          </p>
          <Field label="Category">
            <select value={builderCat} onChange={(e) => setBuilderCat(e.target.value)}>
              {DEFAULT_SYMPTOMS.map(([cat]) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </Field>
          <div className="builderCols">
            <div className="builderCol">
              <div className="cardHead">
                <h4>Symptoms (what the customer notices)</h4>
                <button className="btn tiny ghost" onClick={() => resetBuilderCat("symptomsByCat", builderCat)}>
                  Reset
                </button>
              </div>
              {listFor("symptomsByCat").map((it, i) => (
                <div key={i} className="builderRow">
                  <input value={it} onChange={(e) => editBuilderItem("symptomsByCat", builderCat, i, e.target.value)} placeholder="e.g. Brakes feel soft or mushy" />
                  <button className="lineX" onClick={() => removeBuilderItem("symptomsByCat", builderCat, i)} aria-label="Remove">
                    ✕
                  </button>
                </div>
              ))}
              <button className="btn tiny" onClick={() => addBuilderItem("symptomsByCat", builderCat)}>
                + Symptom
              </button>
            </div>
            <div className="builderCol">
              <div className="cardHead">
                <h4>Findings (what the tech finds)</h4>
                <button className="btn tiny ghost" onClick={() => resetBuilderCat("findingsByCat", builderCat)}>
                  Reset
                </button>
              </div>
              {listFor("findingsByCat").map((it, i) => (
                <div key={i} className="builderRow">
                  <input value={it} onChange={(e) => editBuilderItem("findingsByCat", builderCat, i, e.target.value)} placeholder="e.g. front brake pads worn out" />
                  <button className="lineX" onClick={() => removeBuilderItem("findingsByCat", builderCat, i)} aria-label="Remove">
                    ✕
                  </button>
                </div>
              ))}
              <button className="btn tiny" onClick={() => addBuilderItem("findingsByCat", builderCat)}>
                + Finding
              </button>
              <p className="legalNote" style={{ marginTop: 8 }}>
                Findings read after the word "Found …" — write them lowercase-first, e.g. "front rotors scored or warped."
              </p>
            </div>
          </div>
          </>
          )}
          {show("oilchange") && (
          <>
          <h3 className="subhead">Oil change menu</h3>
          <p className="legalNote" style={{ marginTop: 0 }}>
            What the Oil change button on a ticket offers. Each package includes the quarts shown, the filter, and a fluid
            check; quarts past that are charged per quart. The package price is charged plus tax.
          </p>
          <div className="miniLines">
            {(d.oilPackages || []).map((p, i) => (
              <div key={p.id || i} className="miniLine" style={{ gridTemplateColumns: "2fr 84px 56px 84px 36px" }}>
                <input value={p.name} onChange={(e) => setPkg(i, { name: e.target.value })} placeholder="Valvoline Full Synthetic Oil Change" />
                <input inputMode="decimal" value={p.price} onChange={(e) => setPkg(i, { price: e.target.value })} placeholder="Price" title="Package price" />
                <input inputMode="decimal" value={p.quarts} onChange={(e) => setPkg(i, { quarts: e.target.value })} placeholder="Qt" title="Quarts included" />
                <input inputMode="decimal" value={p.extraQuart} onChange={(e) => setPkg(i, { extraQuart: e.target.value })} placeholder="$/qt over" title="Per quart past the included amount" />
                <button className="lineX" onClick={() => set("oilPackages")(d.oilPackages.filter((_, k) => k !== i))} aria-label="Remove">
                  ✕
                </button>
                <div style={{ gridColumn: "1 / -1" }}>
                  <span className="pkgCommLabel">Commission</span>
                  <div className="commGrid">
                    {COMM_ROLES.map(([role, label]) => {
                      const fc = commToForm(p.commission, split);
                      return (
                        <div key={role} className="commRow">
                          <span>{label}</span>
                          <input
                            inputMode="decimal"
                            value={fc[role].value == null ? "" : fc[role].value}
                            onChange={(e) => setPkg(i, { commission: { ...fc, [role]: { ...fc[role], value: e.target.value.replace(/[^0-9.]/g, "") } } })}
                            placeholder="0"
                          />
                          <select value={fc[role].mode} onChange={(e) => setPkg(i, { commission: { ...fc, [role]: { ...fc[role], mode: e.target.value } } })}>
                            <option value="amt">$</option>
                            <option value="pct">% of pkg</option>
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
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

          </>
          )}
          {show("commissions") && (
          <>
          <h3 className="subhead">Commissions</h3>
          <p className="legalNote" style={{ marginTop: 0 }}>
            Commission is set per service, per position — a fixed dollar amount or a percent of that service's price —
            on each oil package (under Oil change) and each canned job (under Canned jobs), for the advisor on the
            computer, the top tech over the hood, and the pit tech under the car. The shares below are only a fallback,
            used to divide any older service still set to a single flat amount. See who earned what under Reports →
            Commissions.
          </p>
          <div className="fldRow">
            <Field label="Advisor share %">
              <input inputMode="decimal" value={split.advisor} onChange={(e) => setSplit("advisor", e.target.value)} />
            </Field>
            <Field label="Top tech share %">
              <input inputMode="decimal" value={split.top} onChange={(e) => setSplit("top", e.target.value)} />
            </Field>
            <Field label="Pit tech share %">
              <input inputMode="decimal" value={split.pit} onChange={(e) => setSplit("pit", e.target.value)} />
            </Field>
          </div>
          <p className="legalNote" style={{ marginTop: 4 }}>
            Shares are proportions — they don't have to add to 100. Right now:{" "}
            {toNum(split.advisor)} / {toNum(split.top)} / {toNum(split.pit)} (advisor / top / pit).
          </p>

          </>
          )}
          {show("oilchange") && (
          <>
          <h3 className="subhead">Oil-change reminder sticker</h3>
          <p className="legalNote" style={{ marginTop: 0 }}>
            When an oil-change ticket is posted, the reminder sticker pops up to print — vehicle, next service date and mileage, and the oil used, with your shop name and address. Set how far out the next service is.
          </p>
          <div className="fldRow">
            <Field label="Next service in (months)">
              <Text value={d.reminderMonths == null ? "" : String(d.reminderMonths)} onChange={(v) => set("reminderMonths")(v.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder="3" />
            </Field>
            <Field label="Next service in (miles)">
              <Text value={d.reminderMiles == null ? "" : String(d.reminderMiles)} onChange={(v) => set("reminderMiles")(v.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder="3000" />
            </Field>
            <Field label="When a ticket is posted">
              {onOff("oilSticker", "Pop the sticker to print", "Don't print automatically")}
            </Field>
          </div>

          <h3 className="subhead">Service checklist</h3>
          <p className="legalNote" style={{ marginTop: 0 }}>
            The walk-around that prints on the invoice. It opens on its own when an oil-change estimate is approved to a repair order (or when an oil change goes straight onto a repair order) and runs
            from the keyboard: Enter takes the answer, Space picks a different one. An item whose part or service is on
            the ticket starts at Replaced; the words that mean that go in the last box ("oil filter", or "air filter
            -cabin" to leave the cabin filter out, alternatives split with |).
          </p>
          <Field label="When an oil-change ticket becomes a repair order">
            {onOff("checklistOnOil", "Open the checklist automatically", "Wait for the Checklist button")}
          </Field>
          <div className="miniLines">
            {(d.checklist || []).map((it, i) => (
              <div key={it.id || i} className="miniLine" style={{ gridTemplateColumns: "1.3fr 100px 1.7fr 0.9fr 1fr 74px 30px" }}>
                <input value={it.label || ""} onChange={(e) => setCk(i, { label: e.target.value })} placeholder="Engine oil" />
                <select value={it.kind || "choice"} onChange={(e) => setCk(i, { kind: e.target.value })} title="How it's answered">
                  <option value="choice">Choices</option>
                  <option value="text">Typed</option>
                  <option value="depth">Tire depth</option>
                  <option value="pressure">Tire pressure (F/R)</option>
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
                <input
                  inputMode="decimal"
                  value={it.recommendPrice == null || Number(it.recommendPrice) === 0 ? "" : it.recommendPrice}
                  onChange={(e) => setCk(i, { recommendPrice: e.target.value })}
                  placeholder="est $"
                  title="Estimated price shown on the receipt when this item is marked Recommend"
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

          </>
          )}
          {show("company") && (
          <>
          <h3 className="subhead">Printed text</h3>
          <Field label="Authorization line (estimates and repair orders)">
            <textarea className="ta" value={d.authorizationText} onChange={(e) => set("authorizationText")(e.target.value)} />
          </Field>
          <Field label="Invoice footer (warranty, thank-you)">
            <textarea className="ta" value={d.invoiceFooter} onChange={(e) => set("invoiceFooter")(e.target.value)} />
          </Field>

          <h3 className="subhead" style={{ marginTop: 36 }}>
            Work areas
          </h3>
          <p className="legalNote" style={{ marginTop: 0 }}>
            Name your bays or work areas (Bay 1, Bay 2, Alignment…). A ticket can be sent to a bay with the “Send to
            bay” button, and a tablet by the bays — opened to the <strong>Bay display</strong> page — shows the tech
            what's being done on that car.
          </p>
          <div className="miniLines">
            {(d.bays || []).map((b, i) => (
              <div key={b.id || i} className="miniLine" style={{ gridTemplateColumns: "1fr 36px" }}>
                <input value={b.name || ""} onChange={(e) => set("bays")((d.bays || []).map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} placeholder="Bay 1" />
                <button className="lineX" onClick={() => set("bays")((d.bays || []).filter((_, k) => k !== i))} aria-label="Remove">
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div className="addBar">
            <button className="btn tiny" onClick={() => set("bays")([...(d.bays || []), { id: "bay" + Date.now().toString(36), name: "" }])}>
              + Work area
            </button>
          </div>
          </>
          )}
          {show("pricing") && (
          <>
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

          </>
          )}
          {show("customers") && (
          <>
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
          </>
          )}

          {show("servicereview") && (
            <>
              <h3 className="subhead">Service review</h3>
              <p className="muted" style={{ marginTop: 0, maxWidth: 640 }}>
                The "what's due" screen shown at an oil change. Choose where the intervals come from and which services appear.
              </p>
              <div className="grid2">
                <div className="fld">
                  <span>Interval source</span>
                  <select value={d.serviceIntervalSource || "both"} onChange={(e) => set("serviceIntervalSource")(e.target.value)}>
                    <option value="store">Your recommendation only</option>
                    <option value="motor">Manufacturer recommendation (falls back to yours)</option>
                    <option value="both">Both — show yours and the manufacturer side by side</option>
                  </select>
                </div>
                <div className="fld">
                  <span>What to call your recommendations</span>
                  <Text value={d.serviceStoreLabel ?? "Store"} onChange={set("serviceStoreLabel")} placeholder="Store" />
                  <span className="muted" style={{ fontSize: 12 }}>e.g. "Store", "Valvoline", "{cfg.shopName || "Genie"}" — shows on the review next to your intervals.</span>
                </div>
              </div>
              <label className="fld inline" style={{ marginTop: 8 }}>
                <input type="checkbox" checked={d.serviceReviewOnOil !== false} onChange={(e) => set("serviceReviewOnOil")(e.target.checked)} />
                <span>Pop the service review automatically when an oil change is added</span>
              </label>

              <h3 className="subhead" style={{ marginTop: 24 }}>Services &amp; store intervals</h3>
              <p className="muted" style={{ marginTop: 0, maxWidth: 640 }}>
                Uncheck to hide a service. <strong>Basis "On inspection"</strong> (air filters, wipers) shows as "Inspect" — replace when needed, never flagged overdue by mileage. Services tied to a fluid the car doesn't have (power steering, differential) are hidden automatically when MOTOR is connected.
              </p>
              <table className="svcCfg">
                <thead>
                  <tr>
                    <th>Show</th>
                    <th>Service</th>
                    <th>Basis</th>
                    <th className="r">Every miles</th>
                    <th className="r">Every months</th>
                    <th className="r">Menu price</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {svcRows().map((r, i) => (
                    <tr key={r.id || i}>
                      <td className="c"><input type="checkbox" checked={r.enabled !== false} onChange={(e) => setSvc(i, { enabled: e.target.checked })} /></td>
                      <td><input value={r.name || ""} onChange={(e) => setSvc(i, { name: e.target.value })} placeholder="Service name" /></td>
                      <td>
                        <select value={r.basis === "inspect" ? "inspect" : "interval"} onChange={(e) => setSvc(i, { basis: e.target.value })}>
                          <option value="interval">By mileage</option>
                          <option value="inspect">On inspection</option>
                        </select>
                      </td>
                      <td><input className="r" inputMode="numeric" value={r.miles ?? ""} onChange={(e) => setSvc(i, { miles: e.target.value.replace(/[^0-9]/g, "") })} disabled={r.basis === "inspect"} /></td>
                      <td><input className="r" inputMode="numeric" value={r.months ?? ""} onChange={(e) => setSvc(i, { months: e.target.value.replace(/[^0-9]/g, "") })} disabled={r.basis === "inspect"} /></td>
                      <td><input className="r" inputMode="decimal" value={r.price ?? ""} onChange={(e) => setSvc(i, { price: e.target.value.replace(/[^0-9.]/g, "") })} /></td>
                      <td className="c"><button className="lineX" onClick={() => removeSvc(i)} aria-label="Remove" title="Remove">✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="btn tiny" style={{ marginTop: 10 }} onClick={addSvc}>+ Add service</button>
            </>
          )}

          {show("payments") && <PaymentsPanel d={d} set={set} shop={shop} />}

          {section !== "data" && (
            <button className="btn primary lg" onClick={save} style={{ marginTop: 18 }}>
              Save settings
            </button>
          )}

          {show("data") && (
          <>
          <h3 className="subhead" style={{ marginTop: 0 }}>
            Cloud account
          </h3>
          <CloudSync />
          <BackupPanel flash={flash} cfg={cfg} saveCfg={saveCfg} />
          <CarfaxExportPanel cfg={cfg} saveCfg={saveCfg} flash={flash} shop={shop} />
          <ImportPanel roster={roster} saveRoster={saveRoster} flash={flash} shop={shop} />
          <p className="legalNote">
            Posting an invoice freezes the tax rate and supplies rule on that ticket. Changing them here affects new
            tickets and open estimates only.
          </p>
          </>
          )}
        </div>
      </div>
    </>
  );
}

/* Card processing on Stripe Connect. The shop connects its own account, pairs
   a counter reader, and turns card payments on; charges then happen right on
   the ticket (OrderEditor's CardCharge). The platform fee is Bolt Badger's and
   isn't editable here. See src/lib/payments.js and the "pay" Edge Function. */
function PaymentsPanel({ d, set, shop }) {
  const linked = (() => {
    try {
      return DEMO || cloud.getState().linked;
    } catch {
      return DEMO;
    }
  })();
  const [status, setStatus] = useState(null); // { chargesEnabled, ... } | { error }
  const [readers, setReaders] = useState(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  const refresh = async () => {
    if (!linked) return;
    try {
      const s = await connectStatus();
      setStatus(s);
    } catch (e) {
      setStatus({ error: e.message || "Could not reach Stripe." });
    }
    try {
      const r = await listReaders();
      setReaders(r.readers || []);
    } catch {
      setReaders([]);
    }
  };
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked]);

  const startOnboarding = async () => {
    setBusy("connect");
    setMsg("");
    try {
      const { url, simulated } = await connectLink(window.location.href);
      if (simulated) {
        setMsg("Simulated — add your Stripe keys to the pay function to go live.");
        setBusy("");
        await refresh();
        return;
      }
      window.location.href = url; // Stripe-hosted onboarding, returns to the app
    } catch (e) {
      setMsg(e.message || "Could not start onboarding.");
      setBusy("");
    }
  };

  const pairReader = async () => {
    if (!code.trim()) return setMsg("Enter the pairing code shown on the reader.");
    setBusy("reader");
    setMsg("");
    try {
      await registerReader(code.trim(), "Counter reader");
      setCode("");
      setMsg("Reader paired.");
      await refresh();
    } catch (e) {
      setMsg(e.message || "Could not pair the reader.");
    }
    setBusy("");
  };

  const stats = cardPaymentStats(Object.values(shop.orders || {}));
  const fee = platformFeeCfg(d);
  const ready = status && status.chargesEnabled;

  return (
    <>
      <h3 className="subhead">Card processing</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Take cards right on the ticket — on a counter reader or by texting the customer a secure pay link. Powered by
        Stripe; money is deposited to your own bank, usually next business day.
      </p>

      {!linked ? (
        <p className="legalNote">Sign in to your shop's cloud account (Data &amp; backup) to set up card processing.</p>
      ) : (
        <>
          <div className="payStatusRow">
            <span className={`payDot ${ready ? "ok" : "off"}`} />
            <div>
              <strong>
                {status?.error
                  ? "Couldn't reach Stripe"
                  : ready
                    ? `Connected${status.simulated ? " (simulated)" : ""}`
                    : status
                      ? "Not connected yet"
                      : "Checking…"}
              </strong>
              <p className="muted" style={{ margin: "2px 0 0" }}>
                {ready
                  ? "Your shop can accept cards."
                  : "Connect your shop's account to start accepting cards."}
              </p>
            </div>
            <div className="grow" />
            <button className="btn" disabled={busy === "connect"} onClick={startOnboarding}>
              {ready ? "Manage / update" : busy === "connect" ? "Starting…" : "Connect Stripe"}
            </button>
          </div>

          <label className="fld inline" style={{ marginTop: 14 }}>
            <input type="checkbox" checked={!!d.cardPayments} onChange={(e) => set("cardPayments")(e.target.checked)} />
            <span>Accept card payments in the app (show Charge on the payment screen)</span>
          </label>

          <h3 className="subhead" style={{ marginTop: 28 }}>Counter reader</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Pair a Stripe internet reader (WisePOS E or S700). On the reader, go to Settings → Generate pairing code, then
            enter it here.
          </p>
          {readers && readers.length > 0 && (
            <ul className="readerList">
              {readers.map((r) => (
                <li key={r.id}>
                  <span className={`payDot ${r.status === "online" ? "ok" : "off"}`} />
                  {r.label} <span className="muted">· {r.status}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="rowBtns" style={{ maxWidth: 420 }}>
            <input className="search" style={{ flex: 1 }} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Pairing code, e.g. quick-brown-fox" />
            <button className="btn" disabled={busy === "reader"} onClick={pairReader}>
              {busy === "reader" ? "Pairing…" : "Pair reader"}
            </button>
          </div>

          <h3 className="subhead" style={{ marginTop: 28 }}>This shop's card totals</h3>
          <div className="payStats">
            <div>
              <span>Card sales</span>
              <b>{stats.count}</b>
            </div>
            <div>
              <span>Processed</span>
              <b>{fmtMoney(stats.gross)}</b>
            </div>
            <div>
              <span>Processing fees</span>
              <b>{fmtMoney(stats.fees)}</b>
            </div>
          </div>
          <p className="legalNote">
            Platform fee: {fee.pct}%{fee.fixed ? ` + ${fmtMoney(fee.fixed)}` : ""} per card sale, on top of Stripe's own
            processing cost. Set for the product; full payout and payment detail live in your Stripe dashboard.
          </p>
          {msg && <p className="fldErr" style={{ marginTop: 6 }}>{msg}</p>}
        </>
      )}
    </>
  );
}

/* CARFAX Car Care data feed. Builds the two files CARFAX asks for from the
   shop's real tickets: the pipe-delimited service file (Service Network / Vehicle
   History Report) and the customer-list CSV (Shop Loyalty Program). Exported
   here for the sample/onboarding step; a scheduled daily push comes later. */
function downloadText(name, text, type) {
  const blob = new Blob([text], { type: type || "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}

function CarfaxExportPanel({ cfg, saveCfg, flash, shop }) {
  const [c, setC] = useState(() => ({ managementSystem: "Bolt Badger", locationId: "", providerId: "", locationName: cfg.shopName || "", address: "", city: "", state: "", zip: "", ...(cfg.carfax || {}) }));
  const [recent, setRecent] = useState("250");
  const set = (k) => (v) => setC((x) => ({ ...x, [k]: v }));
  const effCfg = { ...cfg, carfax: c };

  const svc = serviceRows(shop.orders, shop.vehicles, effCfg);
  const loy = loyaltyRows(shop.orders, shop.customers, shop.vehicles, effCfg, { monthsBack: 24 });
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const svcToday = serviceRows(shop.orders, shop.vehicles, effCfg, { sinceTs: startOfToday.getTime() });
  const svcRecent = serviceRows(shop.orders, shop.vehicles, effCfg, { recentRecords: Math.max(1, Number(recent) || 250) });

  const save = async () => {
    await saveCfg({ ...cfg, carfax: c });
    flash("CARFAX settings saved");
  };
  const exportService = (status, res) => {
    if (!res.rows.length) return flash("No matching records to export.", "out");
    downloadText(serviceFileName(effCfg, status), serviceFileText(res.rows), "text/plain");
    flash(`Exported ${res.rows.length} service rows`);
  };
  const exportLoyalty = () => {
    if (!loy.rows.length) return flash("No matching records to export.", "out");
    downloadText(loyaltyFileName(effCfg, "HIST"), loyaltyFileText(loy.rows), "text/csv");
    flash(`Exported ${loy.rows.length} customer rows`);
  };

  return (
    <>
      <h3 className="subhead" style={{ marginTop: 36 }}>CARFAX Car Care</h3>
      <p className="muted" style={{ marginTop: 0, maxWidth: 620 }}>
        Build the two files CARFAX asks for from your tickets: the service file (goes on the Vehicle History Report) and the
        customer list (Shop Loyalty Program). Only invoiced tickets with a valid 17-character VIN are included.
      </p>
      <div className="fld">
        <span>Management system name (approved by CARFAX)</span>
        <Text value={c.managementSystem} onChange={set("managementSystem")} />
      </div>
      <div className="grid2">
        <div className="fld">
          <span>Location ID (unique per shop)</span>
          <Text value={c.locationId} onChange={set("locationId")} placeholder="e.g. BOLTBADGER6199711418" />
        </div>
        <div className="fld">
          <span>Provider ID (from CARFAX)</span>
          <Text value={c.providerId} onChange={set("providerId")} placeholder="assigned by CARFAX" />
        </div>
      </div>
      <div className="fld">
        <span>Location name</span>
        <Text value={c.locationName} onChange={set("locationName")} placeholder={cfg.shopName} />
      </div>
      <div className="grid2">
        <div className="fld">
          <span>Street address</span>
          <Text value={c.address} onChange={set("address")} />
        </div>
        <div className="fld">
          <span>City</span>
          <Text value={c.city} onChange={set("city")} />
        </div>
      </div>
      <div className="grid2">
        <div className="fld">
          <span>State</span>
          <Text value={c.state} onChange={set("state")} />
        </div>
        <div className="fld">
          <span>ZIP</span>
          <Text value={c.zip} onChange={set("zip")} inputMode="numeric" />
        </div>
      </div>
      <div className="rowBtns" style={{ marginTop: 12 }}>
        <button className="btn" onClick={save}>Save CARFAX settings</button>
      </div>

      <div className="payStats" style={{ marginTop: 16 }}>
        <div>
          <span>Service rows (all history)</span>
          <b>{svc.rows.length}</b>
        </div>
        <div>
          <span>From invoiced tickets</span>
          <b>{svc.usedOrders}</b>
        </div>
        <div>
          <span>Skipped — no valid VIN</span>
          <b className={svc.skippedNoVin ? "vShort" : ""}>{svc.skippedNoVin}</b>
        </div>
      </div>
      <div className="rowBtns" style={{ marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn primary" onClick={() => exportService("HIST", svcRecent)}>Export most recent</button>
        <input className="search" style={{ width: 84 }} inputMode="numeric" value={recent} onChange={(e) => setRecent(e.target.value.replace(/[^0-9]/g, ""))} aria-label="Number of recent records" />
        <span className="muted">records → {svcRecent.rows.length} rows, {svcRecent.usedOrders} tickets</span>
      </div>
      <div className="rowBtns" style={{ marginTop: 10, flexWrap: "wrap" }}>
        <button className="btn" onClick={() => exportService("HIST", svc)}>Full history (HIST, {svc.rows.length})</button>
        <button className="btn" onClick={() => exportService("PROD", svcToday)}>Today only (PROD, {svcToday.rows.length})</button>
        <button className="btn" onClick={exportLoyalty}>Customer list (HIST, {loy.rows.length})</button>
      </div>
      <p className="legalNote">
        CARFAX needs at least 250 service records to start. Files are sent to CARFAX by FTP (service) / SFTP (loyalty) once
        they issue credentials. Per CARFAX, this data must not be fed into any AI features.
      </p>
    </>
  );
}

/* Download a full backup of the desk's data (everything under sd:*) as a
   JSON file, and restore it. This is the copy you control, on top of the
   live copy in the cloud. */
function BackupPanel({ flash, cfg, saveCfg }) {
  const [busy, setBusy] = useState(false);
  const [restoreFile, setRestoreFile] = useState(null);
  const [count, setCount] = useState(null);
  const [recovered, setRecovered] = useState(null);

  /* Pull the shop's public card back out of the cloud (it lives in its own
     table, so it survives a settings overwrite) and fill the shop-info
     fields from it. Doesn't touch anything the card doesn't cover. */
  const recoverShopInfo = async () => {
    setBusy(true);
    try {
      const p = await cloud.readShopPublic();
      if (!p) {
        flash("Nothing found in the cloud to recover.", "out");
        return;
      }
      const next = {
        ...cfg,
        shopName: p.name || cfg.shopName,
        shopPhone: p.phone || cfg.shopPhone,
        shopAddress: p.address || cfg.shopAddress,
        shopEmail: p.email || cfg.shopEmail,
        shopWebsite: p.website || cfg.shopWebsite,
        hours: p.hours || cfg.hours,
        ardNumber: p.ardNumber || cfg.ardNumber,
        invoiceFooter: p.invoiceFooter || cfg.invoiceFooter,
        logo: p.logo || cfg.logo,
        taxRate: p.taxRate != null && p.taxRate !== "" ? p.taxRate : cfg.taxRate,
      };
      await saveCfg(next);
      const got = ["name", "phone", "address", "email", "website", "hours", "ardNumber", "invoiceFooter"].filter((k) => p[k]);
      setRecovered(got);
      flash(`Recovered shop info from the cloud (${got.length} field${got.length === 1 ? "" : "s"})`);
    } catch (e) {
      flash(`Couldn't recover: ${e.message}`, "out");
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    setBusy(true);
    try {
      const all = await sGetAll("sd:"); // [[key, value]]
      const backup = { format: "shop-desk-backup", version: 1, exportedAt: Date.now(), records: Object.fromEntries(all) };
      const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `shop-desk-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      flash(`Backed up ${all.length.toLocaleString()} records`);
    } catch (e) {
      flash(`Backup failed: ${e.message}`, "out");
    } finally {
      setBusy(false);
    }
  };

  const pick = async (file) => {
    try {
      const j = JSON.parse(await file.text());
      if (j.format !== "shop-desk-backup") throw new Error("That isn't a Shop Desk backup file.");
      setRestoreFile(j);
      setCount(Object.keys(j.records || {}).length);
    } catch (e) {
      flash(e.message, "out");
    }
  };

  const restore = async () => {
    if (!restoreFile) return;
    setBusy(true);
    try {
      const entries = Object.entries(restoreFile.records || {});
      for (const [k, v] of entries) await sSet(k, v);
      flash(`Restored ${entries.length.toLocaleString()} records`);
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      flash(`Restore failed: ${e.message}`, "out");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h3 className="subhead" style={{ marginTop: 36 }}>
        Backup
      </h3>
      <p className="legalNote" style={{ marginTop: 0 }}>
        Your data lives on this computer and, when signed in above, in the shop's cloud account (synced across every
        device). Download a copy you keep — a single file with every customer, vehicle, ticket, part, and setting. Keep
        it somewhere safe; a weekly one is plenty.
      </p>
      <div className="rowBtns">
        <button className="btn primary" onClick={download} disabled={busy}>
          {busy ? "Working…" : "Download a backup"}
        </button>
        <label className="btn">
          Restore from a backup…
          <input
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={(e) => e.target.files && e.target.files[0] && pick(e.target.files[0])}
          />
        </label>
        <button className="btn" onClick={recoverShopInfo} disabled={busy} title="Pull the shop name, phone, address, hours, tax rate and footer back from the cloud's published card">
          Recover shop info from cloud
        </button>
      </div>
      {recovered && (
        <p className="setupNote" style={{ marginTop: 10 }}>
          Recovered from the cloud: {recovered.join(", ")}. Check the fields above and Save settings.
        </p>
      )}
      {restoreFile && (
        <div className="warnBox" style={{ marginTop: 12 }}>
          <p style={{ margin: "0 0 10px" }}>
            Restore {count?.toLocaleString()} records from {new Date(restoreFile.exportedAt).toLocaleString()}? This
            writes them over what's here now and syncs to the cloud. Records added since the backup stay.
          </p>
          <div className="rowBtns">
            <button className="btn danger" onClick={restore} disabled={busy}>
              {busy ? "Restoring…" : "Yes, restore"}
            </button>
            <button className="btn" onClick={() => setRestoreFile(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
