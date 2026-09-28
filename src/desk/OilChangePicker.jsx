import { useState } from "react";
import { Modal, Money, toNum, Field } from "./ui.jsx";
import { oilPackageLines, oilItems, oilFilterItems, oilsForPackage, packageOilType, recommendedPackages, capacityOptions } from "../lib/oilchange.js";
import { matchOil, matchFilter } from "../lib/specs.js";
import { OilSpecLookup } from "./OilSpecLookup.jsx";
import { uid } from "../lib/ids.js";
import { searchText } from "./useShop.js";

/* The oil / filter list, with a search box on top: type a part number (or
   any of its text) and press Enter to pick the top match. Spec matches are
   listed first. */
function PickList({ items, suggested, onPick, kind }) {
  const [q, setQ] = useState("");
  /* alphanumeric by part number, natural order (VO46 before VO161); spec
     matches stay on top, each group sorted */
  const byNum = (a, b) => String(a.number || "").localeCompare(String(b.number || ""), undefined, { numeric: true, sensitivity: "base" });
  const base = [...[...suggested].sort(byNum), ...items.filter((i) => !suggested.includes(i)).sort(byNum)];
  const needle = q.trim().toLowerCase();
  /* rank part-number matches ahead of description matches, so typing a
     number like "CO" picks part CO, not an oil whose description says
     "conv". Lower score = better; ties keep the base order (spec first). */
  const score = (p) => {
    const num = String(p.number || "").trim().toLowerCase();
    if (num && num === needle) return 0; // exact part number
    if (num && num.startsWith(needle)) return 1; // part number prefix
    if (num && num.includes(needle)) return 2; // part number contains
    return searchText(needle, p.number, p.description, p.category) ? 3 : 99; // text
  };
  const list = needle
    ? base
        .map((p) => [p, score(p)])
        .filter(([, s]) => s < 99)
        .sort((a, b) => a[1] - b[1])
        .map(([p]) => p)
    : base;
  return (
    <>
      <input
        className="search"
        style={{ width: "100%", boxSizing: "border-box", margin: "8px 0" }}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Type a part number, then Enter to pick it"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && list.length) onPick(list[0]);
        }}
      />
      <ul className="pickList">
        {list.length === 0 && (
          <li className="emptyNote">{q ? "No match in inventory." : `Nothing in inventory yet that looks like ${kind}. Add it under Inventory, or choose later.`}</li>
        )}
        {list.map((p) => (
          <li key={p.id} className={[toNum(p.onHand) <= 0 ? "low" : "", suggested.includes(p) ? "rec" : ""].join(" ")} onClick={() => onPick(p)}>
            <div className="main">
              <strong>
                {suggested.includes(p) ? <span className="recBadge">✓ Recommended</span> : null}
                {p.number ? `${p.number} — ` : ""}
                {p.description}
              </strong>
              <span>{[p.category, p.location].filter(Boolean).join(" · ")}</span>
            </div>
            <div className="side">
              <strong>{toNum(p.onHand)} on hand</strong>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/* Oil change, three taps: the package, the quarts (from the car's spec
   when known), then which oil and filter off the shelf. Each pick can
   be skipped and set later on the ticket. */
export function OilChangePicker({ cfg, shop, spec, onAdd, onClose }) {
  const packages = (cfg.oilPackages || []).filter((p) => p.active !== false);
  const [pkg, setPkg] = useState(null);
  const [quarts, setQuarts] = useState(spec && spec.oilCapacityQt ? spec.oilCapacityQt : "");
  const [oil, setOil] = useState(null);
  const [step, setStep] = useState("package"); // package | quarts | oil | filter
  const [lookup, setLookup] = useState(false); // the Valvoline grade/capacity lookup
  const [lookedGrade, setLookedGrade] = useState(""); // grade the lookup filled in
  const [autoQt, setAutoQt] = useState(false); // quarts came from the spec without asking
  const caps = capacityOptions(spec);
  const oils = oilItems(shop.parts);
  const filters = oilFilterItems(shop.parts);
  const grade = lookedGrade || (spec ? spec.oilViscosity : "");
  const suggestedOils = grade ? matchOil(shop.parts, grade) : [];
  const suggestedFilters = spec ? matchFilter(shop.parts, spec.oilFilters) : [];
  const q = toNum(quarts) || (pkg ? pkg.quarts : 5);
  const wantType = pkg ? packageOilType(pkg) : null; // the oil type this package calls for, or null

  const finish = (filt) => onAdd(oilPackageLines(pkg, q, oil, filt, uid), pkg);

  if (lookup)
    return (
      <OilSpecLookup
        onClose={() => setLookup(false)}
        onApply={({ grade: g, qt }) => {
          if (qt) setQuarts(qt);
          if (g) setLookedGrade(g);
          setLookup(false);
        }}
      />
    );

  if (step === "package") {
    /* packages that fit the car's recommended oil go first, in green */
    const rec = recommendedPackages(packages, oils, { ...(spec || {}), oilViscosity: grade });
    const ordered = [...packages.filter((p) => rec.ids.has(p.id)), ...packages.filter((p) => !rec.ids.has(p.id))];
    return (
      <Modal title="Oil change" onClose={onClose} size="wide">
        {packages.length === 0 && <p className="muted">No oil change packages yet. Add them under Settings → Oil change menu.</p>}
        {packages.length > 0 && (
          <p className="muted" style={{ marginTop: 0 }}>
            {rec.grade
              ? rec.ids.size
                ? `This car takes ${rec.grade}${spec && spec.oilCapacityQt ? `, ${spec.oilCapacityQt} qt` : ""}. The packages in green have ${rec.grade} on the shelf.`
                : `This car takes ${rec.grade}. No package has ${rec.grade} in inventory right now.`
              : "No oil grade on file for this car. Look it up on the next step, or check the cap."}
          </p>
        )}
        <ul className="pickList">
          {ordered.map((p) => (
            <li
              key={p.id}
              className={rec.ids.has(p.id) ? "rec" : ""}
              onClick={() => {
                setPkg(p);
                /* one capacity on file: use it and go straight to the oil;
                   several (by drive) or none: ask */
                if (caps.length === 1 && !lookedGrade) {
                  setQuarts(String(caps[0].qt));
                  setAutoQt(true);
                  setStep("oil");
                } else setStep("quarts");
              }}
            >
              <div className="main">
                <strong>
                  {rec.ids.has(p.id) ? <span className="recBadge">✓ Recommended</span> : null}
                  {p.name}
                </strong>
                <span>
                  Up to {p.quarts} qt, then <Money v={p.extraQuart} /> per quart{p.details ? ` · ${p.details}` : ""}
                </span>
              </div>
              <div className="side">
                <strong>
                  <Money v={p.price} />
                </strong>
                + tax
              </div>
            </li>
          ))}
        </ul>
      </Modal>
    );
  }

  if (step === "quarts")
    return (
      <Modal title={pkg.name} onClose={onClose}>
        <p className="muted" style={{ marginTop: 0 }}>
          How many quarts does this engine take?{spec && spec.oilCapacityQt ? ` The spec on file says ${spec.oilCapacityQt} qt${grade ? ` of ${grade}` : ""}.` : " Check the cap or the specs card."}
        </p>
        {caps.length > 1 && (
          <>
            <p style={{ margin: "0 0 8px", fontWeight: 600 }}>This engine's capacity depends on the car. Which one is it?</p>
            <div className="chipRow" style={{ marginBottom: 12 }}>
              {caps.map((c) => (
                <button
                  key={`${c.qt}${c.label}`}
                  type="button"
                  className={`btn lg ${toNum(quarts) === c.qt ? "primary" : ""}`}
                  onClick={() => {
                    setQuarts(String(c.qt));
                    setStep("oil");
                  }}
                >
                  {c.qt} qt{c.label ? ` · ${c.label}` : ""}
                </button>
              ))}
            </div>
          </>
        )}
        <Field label={caps.length > 1 ? "Or type the quarts" : "Quarts"}>
          <input
            inputMode="decimal"
            value={quarts}
            onChange={(e) => setQuarts(e.target.value)}
            placeholder={spec && spec.oilCapacityQt ? String(spec.oilCapacityQt) : "quarts"}
            autoFocus
            style={{ width: "100%", boxSizing: "border-box" }}
          />
        </Field>
        <p className="muted">
          {q > pkg.quarts ? (
            <>
              {pkg.quarts} qt included, {Math.round((q - pkg.quarts) * 10) / 10} extra at <Money v={pkg.extraQuart} /> each.
            </>
          ) : (
            <>All {q || pkg.quarts} qt included in the package.</>
          )}
        </p>
        <button className="btn lg full" style={{ marginBottom: 8 }} onClick={() => setLookup(true)}>
          Look up grade &amp; capacity (Valvoline)
        </button>
        <button className="btn primary lg full" onClick={() => setStep("oil")}>
          Next: which oil
        </button>
      </Modal>
    );

  if (step === "oil")
    return (
      <Modal title={`Which ${wantType ? `${wantType} ` : ""}oil?${grade ? ` (spec: ${grade})` : ""}`} onClose={onClose} size="wide">
        <div className="rowBtns">
          <button className="btn" onClick={() => setStep("filter")}>
            Choose later
          </button>
        </div>
        <p className="muted" style={{ margin: "8px 0 0" }}>
          <strong style={{ color: "var(--ink)" }}>{q} qt</strong>
          {autoQt ? " from the car's spec" : ""}
          {q > pkg.quarts ? ` (${Math.round((q - pkg.quarts) * 10) / 10} extra at $${Number(pkg.extraQuart || 0).toFixed(2)})` : ""} ·{" "}
          <button type="button" className="linkBtn" style={{ fontSize: 13 }} onClick={() => (setAutoQt(false), setStep("quarts"))}>
            change quarts
          </button>
          <br />
          Only oils that fit the {pkg.name}. To offer another oil here, set its packages under Inventory.
        </p>
        <PickList
          items={oilsForPackage(oils, pkg)}
          suggested={oilsForPackage(suggestedOils, pkg)}
          kind={`${wantType ? `${wantType} ` : ""}motor oil`}
          onPick={(p) => {
            setOil(p);
            setStep("filter");
          }}
        />
      </Modal>
    );

  return (
    <Modal title="Which oil filter?" onClose={onClose} size="wide">
      <div className="rowBtns">
        <button className="btn" onClick={() => finish(null)}>
          Choose later
        </button>
      </div>
      <PickList items={filters} suggested={suggestedFilters} kind="an oil filter" onPick={(p) => finish(p)} />
    </Modal>
  );
}
