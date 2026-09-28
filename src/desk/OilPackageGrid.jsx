import { useMemo, useState } from "react";
import { Modal, toNum } from "./ui.jsx";
import { oilItems, oilPackagesOf, toggleOilPackage, oilTypeOf, OIL_TYPE_OPTIONS } from "../lib/oilchange.js";

/* Every motor oil against every oil-change package on one screen: tick
   which packages each oil is offered in, instead of opening oils one at a
   time. An oil nobody has set yet follows its oil type ("auto"). Changes
   are held until Save. */
export function OilPackageGrid({ shop, cfg, flash, onClose }) {
  const pkgs = (cfg.oilPackages || []).filter((k) => k.active !== false);
  const oils = useMemo(
    () =>
      oilItems(shop.parts).sort(
        (a, b) => String(oilTypeOf(a) || "").localeCompare(String(oilTypeOf(b) || "")) || String(a.description || "").localeCompare(String(b.description || ""))
      ),
    [shop.parts]
  );
  const [edits, setEdits] = useState({}); // oil id → new packages array
  const [busy, setBusy] = useState(false);
  const cur = (p) => (p.id in edits ? { ...p, packages: edits[p.id] } : p);
  const typeLabel = (t) => (OIL_TYPE_OPTIONS.find((o) => o[0] === t) || [t, t === "maxlife" ? "High mileage" : t || "No type"])[1];

  const toggle = (p, pkgId) => setEdits((m) => ({ ...m, [p.id]: toggleOilPackage(cur(p), pkgId, pkgs) }));
  const column = (pkgId, on) =>
    setEdits((m) => {
      const next = { ...m };
      for (const p of oils) {
        const c = p.id in next ? { ...p, packages: next[p.id] } : p;
        if (oilPackagesOf(c, pkgs).ids.includes(pkgId) !== on) next[p.id] = toggleOilPackage(c, pkgId, pkgs);
      }
      return next;
    });
  const changed = oils.filter((p) => p.id in edits && JSON.stringify(edits[p.id] || []) !== JSON.stringify(p.packages || []));

  const save = async () => {
    setBusy(true);
    try {
      await shop.savePartsBulk(changed.map((p) => ({ ...p, packages: edits[p.id] })));
      flash(`Saved ${changed.length} oil${changed.length === 1 ? "" : "s"}`);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Match oils to packages" onClose={onClose} size="xwide">
      <p className="muted" style={{ marginTop: 0 }}>
        Tick the oil change packages each oil can be sold in. The oil picker on a ticket then offers only those oils for that package. An oil marked
        Auto hasn't been set yet and follows its oil type.
      </p>
      {pkgs.length === 0 ? (
        <p className="emptyNote">No oil change packages yet. Set them up under Settings → Oil change.</p>
      ) : oils.length === 0 ? (
        <p className="emptyNote">No motor oils in inventory yet.</p>
      ) : (
        <div className="opgWrap">
          <table className="dk opg">
            <thead>
              <tr>
                <th>Oil</th>
                {pkgs.map((k) => (
                  <th key={k.id} className="opgPkg">
                    <span>{k.name}</span>
                    <span className="opgCol">
                      <button type="button" className="linkBtn" onClick={() => column(k.id, true)}>
                        all
                      </button>
                      <button type="button" className="linkBtn" onClick={() => column(k.id, false)}>
                        none
                      </button>
                    </span>
                  </th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {oils.map((p, i) => {
                const c = cur(p);
                const eff = oilPackagesOf(c, pkgs);
                const type = oilTypeOf(p);
                const newType = i === 0 || oilTypeOf(oils[i - 1]) !== type;
                return (
                  <tr key={p.id} className={newType ? "opgFirst" : ""}>
                    <td>
                      <strong>{p.description || p.number}</strong>
                      <span className="sub">
                        {[p.number, typeLabel(type), `${toNum(p.onHand)} on hand`].filter(Boolean).join(" · ")}
                        {eff.auto ? <span className="opgAuto">Auto</span> : null}
                        {p.id in edits ? <span className="opgChanged">Changed</span> : null}
                      </span>
                    </td>
                    {pkgs.map((k) => (
                      <td key={k.id} className="opgCell">
                        <input type="checkbox" checked={eff.ids.includes(k.id)} onChange={() => toggle(p, k.id)} aria-label={`${p.description} in ${k.name}`} />
                      </td>
                    ))}
                    <td className="r">
                      {!eff.auto && (
                        <button type="button" className="btn tiny ghost" onClick={() => setEdits((m) => ({ ...m, [p.id]: [] }))} title="Go back to matching by oil type">
                          Auto
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="rowBtns" style={{ marginTop: 14 }}>
        <button className="btn primary lg" disabled={busy || changed.length === 0} onClick={save}>
          {busy ? "Saving…" : changed.length ? `Save ${changed.length} change${changed.length === 1 ? "" : "s"}` : "No changes yet"}
        </button>
        <button className="btn lg" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
