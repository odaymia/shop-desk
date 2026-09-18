import { useState } from "react";
import { Modal, Money, toNum, Field } from "./ui.jsx";
import { oilPackageLines, oilItems, oilFilterItems, oilsForPackage, packageOilType } from "../lib/oilchange.js";
import { matchOil, matchFilter } from "../lib/specs.js";
import { OilSpecLookup } from "./OilSpecLookup.jsx";
import { uid } from "../lib/ids.js";
import { searchText } from "./useShop.js";

/* The oil / filter list, with a search box on top: type a part number (or
   any of its text) and press Enter to pick the top match. Spec matches are
   listed first. */
function PickList({ items, suggested, onPick, kind }) {
  const [q, setQ] = useState("");
  const base = [...suggested, ...items.filter((i) => !suggested.includes(i))];
  const list = q ? base.filter((p) => searchText(q, p.number, p.description, p.category)) : base;
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
          <li key={p.id} className={toNum(p.onHand) <= 0 ? "low" : ""} onClick={() => onPick(p)}>
            <div className="main">
              <strong>
                {p.number ? `${p.number} — ` : ""}
                {p.description}
                {suggested.includes(p) ? " · matches the spec" : ""}
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
  const [allOils, setAllOils] = useState(false); // show every oil, past the package's type
  const [lookup, setLookup] = useState(false); // the Valvoline grade/capacity lookup
  const [lookedGrade, setLookedGrade] = useState(""); // grade the lookup filled in
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

  if (step === "package")
    return (
      <Modal title="Oil change" onClose={onClose} size="wide">
        {packages.length === 0 && <p className="muted">No oil change packages yet. Add them under Settings → Oil change menu.</p>}
        <ul className="pickList">
          {packages.map((p) => (
            <li
              key={p.id}
              onClick={() => {
                setPkg(p);
                setStep("quarts");
              }}
            >
              <div className="main">
                <strong>{p.name}</strong>
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

  if (step === "quarts")
    return (
      <Modal title={pkg.name} onClose={onClose}>
        <p className="muted" style={{ marginTop: 0 }}>
          How many quarts does this engine take?{spec && spec.oilCapacityQt ? ` The spec on file says ${spec.oilCapacityQt} qt${grade ? ` of ${grade}` : ""}.` : " Check the cap or the specs card."}
        </p>
        <Field label="Quarts">
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
      <Modal title={`Which ${wantType && !allOils ? `${wantType} ` : ""}oil?${grade ? ` (spec: ${grade})` : ""}`} onClose={onClose} size="wide">
        <div className="rowBtns">
          <button className="btn" onClick={() => setStep("filter")}>
            Choose later
          </button>
          {wantType && (
            <button className="btn ghost" onClick={() => setAllOils((x) => !x)}>
              {allOils ? `Only ${wantType} oils` : "Show all oils"}
            </button>
          )}
        </div>
        {wantType && !allOils && (
          <p className="muted" style={{ margin: "8px 0 0" }}>
            Showing {wantType} oils to match the {pkg.name}.
          </p>
        )}
        <PickList
          items={allOils ? oils : oilsForPackage(oils, pkg)}
          suggested={allOils ? suggestedOils : oilsForPackage(suggestedOils, pkg)}
          kind={`${wantType && !allOils ? `${wantType} ` : ""}motor oil`}
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
