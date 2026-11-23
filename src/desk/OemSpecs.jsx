import { qtText } from "../lib/oemData.js";

/* Factory fluids and service schedule for the car on the ticket, from the
   shop's own research in owner's manuals (src/lib/oemData.js). Shown as the
   manual gives it: each amount carries the manual's own wording for what it
   is (a drain-and-refill quantity, or only a system capacity), rows that
   depend on something not yet known about the car say what, and rows the
   research couldn't confirm are marked. `onPick` saves what a person tells
   it about this car (which listing, engine, drive, transmission). */

const DRIVE = { "2wd": "2WD (front or rear)", awd: "AWD / 4WD" };
const TRANS = { auto: "Automatic", manual: "Manual" };
const mi = (n) => `${Number(n).toLocaleString()} mi`;
const when = (miles, months) => [miles ? mi(miles) : "", months ? `${months} mo` : ""].filter(Boolean).join(" / ");

function Choice({ label, value, options, onChange }) {
  return (
    <label className="oemChoice">
      <span>{label}</span>
      <select value={value || ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">Not sure</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

export function OemSpecsCard({ view, vehicle, oil, onPick }) {
  if (!view) return null;
  const pick = vehicle.oem || {};
  const rows = [...view.fluids, ...view.services];
  const asks = (dim) => rows.some((r) => r.open && r.open.includes(dim));
  const showEngine = view.facets.engines.length > 1 && (asks("engine") || !!pick.engine);
  const showDrive = asks("drive") || !!pick.drive;
  const showTrans = asks("trans") || !!pick.trans;
  const showListing = view.listings.length > 1;
  const live = view.fluids.filter((r) => !r.na);
  const none = view.fluids.filter((r) => r.na);
  const sched = view.services.filter((r) => !r.na && /^(replace|inspect)/i.test(r.action));
  const set = (k) => (v) => onPick && onPick({ [k]: v || undefined });

  return (
    <div className="card specs" style={{ marginTop: 14 }}>
      <div className="cardHead">
        <h3>
          Factory specs <span className="st" style={{ marginLeft: 8 }}>owner's manual</span>
        </h3>
        <span className="muted" style={{ fontSize: 13 }}>
          {view.year} {view.make} {view.listing}
        </span>
      </div>

      {/* these describe the car, not the ticket, so they can be set on a posted invoice too */}
      {(showListing || showEngine || showDrive || showTrans) && (
        <div className="oemChoices">
          {showListing && (
            <label className="oemChoice">
              <span>Which one</span>
              <select value={view.sure ? view.listing : ""} onChange={(e) => set("listing")(e.target.value)}>
                {!view.sure && <option value="">Pick one</option>}
                {view.listings.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}
          {showEngine && <Choice label="Engine" value={pick.engine} options={view.facets.engines.map((e) => [e, `${e}L`])} onChange={set("engine")} />}
          {showDrive && <Choice label="Drive" value={pick.drive} options={Object.entries(DRIVE)} onChange={set("drive")} />}
          {showTrans && <Choice label="Transmission" value={pick.trans} options={Object.entries(TRANS)} onChange={set("trans")} />}
        </div>
      )}
      {!view.sure && (
        <p className="oemWarn">
          This could be the {view.listings.join(" or the ")}. Pick which one above. Until then nothing here is filled in for you.
        </p>
      )}
      {view.sure && oil && (
        <p className="oemOil">
          Oil change: <b>{oil.grade}</b> · <b>{qtText(oil.qt)}</b> with filter
          {oil.spec ? ` · ${oil.spec}` : ""}
        </p>
      )}

      <div className="dataScroll" style={{ maxHeight: 340 }}>
        <table className="dk oemTable">
          <thead>
            <tr>
              <th>Fluid</th>
              <th>Spec</th>
              <th className="r">Amount</th>
              <th>As the manual gives it</th>
            </tr>
          </thead>
          <tbody>
            {live.map((r, i) => (
              <tr key={i} className={r.fit === "maybe" ? "oemMaybe" : ""}>
                <td>
                  <b>{r.component}</b>
                  {r.fit === "maybe" ? <span className="sub oemIf">Only for: {r.scope}</span> : null}
                </td>
                <td>{r.spec}</td>
                <td className="r num">{r.qt != null ? qtText(r.qt) : "—"}</td>
                <td className="muted">
                  {r.basis}
                  {!r.verified ? <span className="sub oemUnv">{r.status}</span> : null}
                  {r.page ? <span className="sub">{r.page}</span> : null}
                </td>
              </tr>
            ))}
            {live.length === 0 && (
              <tr>
                <td colSpan={4} className="emptyNote">
                  No fluid rows for this configuration.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {none.length > 0 && (
        <p className="muted" style={{ margin: "10px 0 0", fontSize: 13 }}>
          Not on this car: {[...new Set(none.map((r) => `${r.component}${r.fit === "maybe" ? ` (${r.scope})` : ""}`))].join(" · ")}
        </p>
      )}

      {sched.length > 0 && (
        <details className="oemSched">
          <summary>Factory service schedule ({sched.length})</summary>
          <div className="dataScroll" style={{ maxHeight: 320 }}>
            <table className="dk oemTable">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Do</th>
                  <th>First</th>
                  <th>Then every</th>
                  <th>When it applies</th>
                </tr>
              </thead>
              <tbody>
                {sched.map((r, i) => (
                  <tr key={i} className={r.fit === "maybe" ? "oemMaybe" : ""}>
                    <td>
                      <b>{r.service}</b>
                      {r.fit === "maybe" ? <span className="sub oemIf">Only for: {r.scope}</span> : null}
                    </td>
                    <td>{r.action}</td>
                    <td className="num">{when(r.firstMiles, r.firstMonths) || "—"}</td>
                    <td className="num">{when(r.repeatMiles, r.repeatMonths) || "—"}</td>
                    <td className="muted">
                      {r.use === "special" ? <b className="oemSpecial">Special use only. </b> : null}
                      {r.notes}
                      {!r.verified ? <span className="sub oemUnv">{r.status}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <p className="legalNote" style={{ marginTop: 10 }}>
        From your shop's research in the owner's manual and maintenance guide. An amount is an oil-change quantity only
        where the manual says drain and refill; the rest are system capacities, not refill amounts. Confirm the level on
        the dipstick.
      </p>
    </div>
  );
}
