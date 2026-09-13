import { useState, useEffect, useMemo } from "react";
import { Modal } from "./ui.jsx";
import { loadValvolineSpecs, specMakes, specModels, specEngines, enginesProducts, engineFluids, qtText } from "../lib/valvolineSpecs.js";

/* "Extended Protection Full Synthetic SAE 5W-30 Motor Oil" -> the short way
   a counter person would say it. */
const shortProduct = (name) =>
  String(name || "")
    .replace(/\s*Motor Oil\s*$/i, "")
    .replace(/\bSAE\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
const productLabel = (name) => "Valvoline " + shortProduct(name);

/* Look up a vehicle's engine-oil grade and capacity from Valvoline's data,
   Make -> Model -> Engine, all searchable. When `onApply` is given (opened
   from an oil change) the result can be dropped straight onto the ticket. */
export function OilSpecLookup({ start, onApply, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);
  const [make, setMake] = useState(start?.make || "");
  const [model, setModel] = useState("");
  const [engine, setEngine] = useState(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let ok = true;
    loadValvolineSpecs().then((d) => ok && setData(d)).catch(() => ok && setErr(true));
    return () => { ok = false; };
  }, []);

  const step = engine ? "result" : model ? "engine" : make ? "model" : "make";

  const makes = useMemo(() => specMakes(data), [data]);
  const models = useMemo(() => (make ? specModels(data, make) : []), [data, make]);
  const engines = useMemo(() => (make && model ? specEngines(data, make, model) : []), [data, make, model]);

  const shownMakes = useMemo(() => {
    const s = q.toLowerCase();
    return makes.filter((m) => !s || m.toLowerCase().includes(s)).slice(0, 300);
  }, [makes, q]);
  const shownModels = useMemo(() => {
    const s = q.toLowerCase();
    return models.filter((m) => !s || m.toLowerCase().includes(s));
  }, [models, q]);
  const shownEngines = useMemo(() => {
    const s = q.toLowerCase();
    return engines.filter((e) => !s || String(e.e).toLowerCase().includes(s));
  }, [engines, q]);

  const back = () => {
    setQ("");
    if (engine) setEngine(null);
    else if (model) setModel("");
    else if (make) setMake("");
  };

  const title =
    step === "make" ? "Oil spec — pick the make" :
    step === "model" ? `Oil spec — ${make}` :
    step === "engine" ? `Oil spec — ${make} ${model}` :
    "Oil spec";

  return (
    <Modal title={title} onClose={onClose} size="wide">
      {!data && !err && <p className="muted">Loading Valvoline's vehicle data…</p>}
      {err && <p className="muted">Couldn't load the vehicle data. Try again.</p>}

      {data && step !== "result" && (
        <>
          <div className="rowBtns" style={{ marginBottom: 8 }}>
            {make && (
              <button className="btn" onClick={back}>
                ← Back
              </button>
            )}
            <input
              className="search"
              style={{ flex: 1 }}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={step === "make" ? "Search make" : step === "model" ? "Search model" : "Search engine"}
              autoFocus
            />
          </div>
          <ul className="pickList">
            {step === "make" &&
              shownMakes.map((m) => (
                <li key={m} onClick={() => { setMake(m); setQ(""); }}>
                  <div className="main"><strong>{m}</strong></div>
                </li>
              ))}
            {step === "model" &&
              (shownModels.length ? shownModels : []).map((m) => (
                <li key={m} onClick={() => { setModel(m); setQ(""); }}>
                  <div className="main"><strong>{m}</strong></div>
                </li>
              ))}
            {step === "engine" &&
              shownEngines.map((e) => (
                <li key={e.e} onClick={() => { setEngine(e); setQ(""); }}>
                  <div className="main"><strong>{e.e}</strong></div>
                  <div className="side">
                    <strong>{e.g || "—"}</strong>
                    <span className="muted">{qtText(e.q)}</span>
                  </div>
                </li>
              ))}
            {((step === "make" && !shownMakes.length) || (step === "model" && !shownModels.length) || (step === "engine" && !shownEngines.length)) && (
              <li className="emptyNote">Nothing matches.</li>
            )}
          </ul>
        </>
      )}

      {data && step === "result" && engine && (
        <div>
          <button className="btn" onClick={back} style={{ marginBottom: 12 }}>
            ← Back
          </button>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="cardHead">
              <h3>{make} {model}</h3>
            </div>
            <p className="muted" style={{ marginTop: 0 }}>{engine.e}</p>
            <div className="specGrid">
              <span>Oil grade</span>
              <strong>{engine.g || "not listed"}</strong>
              <span>Oil capacity</span>
              <strong>{engine.q ? `${engine.q} quarts` : "not listed"}</strong>
            </div>
            {(() => {
              const all = enginesProducts(data, engine);
              /* Valvoline lists every oil that will physically work, including
                 off-grade ones (10W-30, diesel) — the shop wants the ones in
                 the car's grade. Fall back to the full list if none match. */
              const g = String(engine.g || "").trim();
              const gradeRe = g && new RegExp("(^|[^0-9])" + g.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&") + "([^0-9]|$)", "i");
              const matched = gradeRe ? all.filter((n) => gradeRe.test(n)) : all;
              const products = matched.length ? matched : all;
              if (!products.length) return null;
              return (
                <div style={{ marginTop: 14 }}>
                  <div className="muted" style={{ marginBottom: 6 }}>
                    {products.length === 1 ? "The only Valvoline oil that works:" : `Valvoline oils that work (${products.length}):`}
                  </div>
                  <ul className="prodList">
                    {products.map((p) => (
                      <li key={p}>{productLabel(p)}</li>
                    ))}
                  </ul>
                </div>
              );
            })()}
            {(() => {
              const fluids = engineFluids(data, engine);
              if (!fluids.length) return null;
              return (
                <div style={{ marginTop: 14 }}>
                  <div className="muted" style={{ marginBottom: 6 }}>Other fluids Valvoline recommends</div>
                  <div className="fluidGrid">
                    {fluids.map((f) => (
                      <div key={f.system} className="fluidRow">
                        <div className="fSys">{f.system}</div>
                        <div className="fProd">{f.products.map(shortProduct).join(" · ")}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
            <p className="legalNote" style={{ marginTop: 10 }}>
              From Valvoline's published product finder. Capacity is a guide — confirm on the dipstick.
            </p>
          </div>
          {onApply && (
            <button
              className="btn primary lg full"
              onClick={() => onApply({ grade: engine.g || "", qt: engine.q || "", vehicle: `${make} ${model}`, engine: engine.e })}
            >
              Use {engine.g ? engine.g : "these numbers"}{engine.q ? ` · ${engine.q} qt` : ""} on this oil change
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
