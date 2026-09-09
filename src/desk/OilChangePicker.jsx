import { useState } from "react";
import { Modal, Money, toNum } from "./ui.jsx";
import { oilPackageLines, oilItems, filterItems } from "../lib/oilchange.js";
import { matchOil, matchFilter } from "../lib/specs.js";
import { uid } from "../lib/ids.js";

/* Oil change, three taps: the package, the quarts (from the car's spec
   when known), then which oil and filter off the shelf. Each pick can
   be skipped and set later on the ticket. */
export function OilChangePicker({ cfg, shop, spec, onAdd, onClose }) {
  const packages = (cfg.oilPackages || []).filter((p) => p.active !== false);
  const [pkg, setPkg] = useState(null);
  const [quarts, setQuarts] = useState(spec && spec.oilCapacityQt ? spec.oilCapacityQt : "");
  const [oil, setOil] = useState(null);
  const [step, setStep] = useState("package"); // package | quarts | oil | filter
  const oils = oilItems(shop.parts);
  const filters = filterItems(shop.parts);
  const grade = spec ? spec.oilViscosity : "";
  const suggestedOils = grade ? matchOil(shop.parts, grade) : [];
  const suggestedFilters = spec ? matchFilter(shop.parts, spec.oilFilters) : [];
  const q = toNum(quarts) || (pkg ? pkg.quarts : 5);

  const finish = (filt) => onAdd(oilPackageLines(pkg, q, oil, filt, uid), pkg);

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
        <div className="countRow">
          {[4, 5, 6, 7, 8].map((n) => (
            <button key={n} className={`btn ${q === n ? "primary" : ""}`} onClick={() => setQuarts(n)}>
              {n}
            </button>
          ))}
          <input className="search" style={{ minWidth: 0, width: 90 }} inputMode="decimal" value={quarts} onChange={(e) => setQuarts(e.target.value)} placeholder="qt" />
        </div>
        <p className="muted">
          {q > pkg.quarts ? (
            <>
              {pkg.quarts} qt included, {Math.round((q - pkg.quarts) * 10) / 10} extra at <Money v={pkg.extraQuart} /> each.
            </>
          ) : (
            <>All {q || pkg.quarts} qt included in the package.</>
          )}
        </p>
        <button className="btn primary lg full" onClick={() => setStep("oil")}>
          Next: which oil
        </button>
      </Modal>
    );

  const PickList = ({ items, suggested, onPick, kind }) => {
    const list = [...suggested, ...items.filter((i) => !suggested.includes(i))];
    return (
      <ul className="pickList">
        {list.length === 0 && <li className="emptyNote">Nothing in inventory yet that looks like {kind}. Add it under Inventory, or choose later.</li>}
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
    );
  };

  if (step === "oil")
    return (
      <Modal title={`Which oil?${grade ? ` (spec: ${grade})` : ""}`} onClose={onClose} size="wide">
        <div className="rowBtns">
          <button className="btn" onClick={() => setStep("filter")}>
            Choose later
          </button>
        </div>
        <PickList
          items={oils}
          suggested={suggestedOils}
          kind="motor oil"
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
