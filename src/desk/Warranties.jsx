import { useMemo, useState } from "react";
import { Modal, Field, Num, Money, fmtDate, toNum } from "./ui.jsx";
import { customerName, vehicleName, searchText } from "./useShop.js";
import { uid } from "../lib/ids.js";
import { tireWarranties, warrantyStatus, warrantyTerms, roadHazardCredit, treadlifeCredit, claimLineLabel } from "../lib/warranty.js";

/* Tire warranties: every tire sale, whether it carries road hazard, and a
   claim flow that prorates the credit and opens the replacement ticket with
   it already on. Records are read from invoiced tickets — nothing is stored
   twice — so what's covered always matches what was actually sold. */

const custLabel = (c) => (c ? customerName(c) || c.phone || "Walk-in" : "Walk-in");

export function Warranties({ shop, cfg, nav, onNew }) {
  const [q, setQ] = useState("");
  const [only, setOnly] = useState("all"); // all | hazard | active
  const [claim, setClaim] = useState(null); // the record being claimed against
  const now = Date.now();

  const records = useMemo(() => tireWarranties({ orders: shop.orders }), [shop.orders]);
  const rows = useMemo(() => {
    return records
      .map((r) => {
        const c = r.customerId && shop.customers[r.customerId];
        const v = r.vehicleId && shop.vehicles[r.vehicleId];
        const st = warrantyStatus(r, cfg, now);
        const hay = [custLabel(c), c && c.phone, vehicleName(v), v && v.plate, r.number, ...r.tires.map((t) => t.size), ...r.tires.flatMap((t) => t.dots)].filter(Boolean).join(" ");
        return { r, c, v, st, hay };
      })
      .filter((x) => searchText(q, x.hay))
      .filter((x) => (only === "hazard" ? x.r.roadHazard : only === "active" ? x.st.roadHazard.active : true));
  }, [records, shop.customers, shop.vehicles, cfg, q, only, now]);

  const activeRh = rows.filter((x) => x.st.roadHazard.active).length;
  const soldRh = records.filter((r) => r.roadHazard).length;

  return (
    <>
      <header className="deskHead">
        <h1>Warranties</h1>
        <div className="seg">
          {[["all", "All sales"], ["hazard", "Road hazard"], ["active", "Active"]].map(([k, label]) => (
            <button key={k} className={only === k ? "on" : ""} onClick={() => setOnly(k)}>
              {label}
            </button>
          ))}
        </div>
        <div className="grow" />
        <input className="search" placeholder="Customer, plate, size, DOT, invoice #" value={q} onChange={(e) => setQ(e.target.value)} />
      </header>
      <div className="deskBody">
        <div className="statRow">
          <div className="stat">
            <span>Tire sales on file</span>
            <strong>{records.length}</strong>
          </div>
          <div className="stat">
            <span>Road hazard sold</span>
            <strong>{soldRh}</strong>
          </div>
          <div className="stat">
            <span>Road hazard active now</span>
            <strong style={activeRh ? { color: "var(--accent)" } : null}>{activeRh}</strong>
          </div>
        </div>
        <div className="card">
          <div className="cardHead">
            <h3>Tire sales &amp; coverage ({rows.length})</h3>
          </div>
          <table className="dk">
            <thead>
              <tr>
                <th>Sold</th>
                <th>Customer</th>
                <th>Vehicle</th>
                <th>Tires</th>
                <th>Coverage</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="emptyNote">
                    {q ? "No tire sales match." : "No tire sales yet. Sold tires show here with their road-hazard and tread-life coverage."}
                  </td>
                </tr>
              )}
              {rows.slice(0, 200).map(({ r, c, v, st }) => (
                <tr key={r.orderId} className="row" onClick={() => setClaim(r)}>
                  <td className="muted num">{fmtDate(r.at)}</td>
                  <td>
                    <strong>{custLabel(c)}</strong>
                    <span className="sub">#{r.number}</span>
                  </td>
                  <td className="muted">{vehicleName(v) || "—"}</td>
                  <td className="muted">{r.tires.map((t) => `${t.qty} × ${t.size}`).join(", ")}</td>
                  <td>
                    {r.roadHazard ? (
                      st.roadHazard.active ? (
                        <span className="svcBadge soon">Road hazard · {st.roadHazard.daysLeft > 0 ? `${st.roadHazard.daysLeft}d left` : "ends today"}</span>
                      ) : (
                        <span className="svcBadge" style={{ opacity: 0.6 }}>Road hazard · expired</span>
                      )
                    ) : (
                      <span className="muted">—</span>
                    )}
                    {st.treadlife ? <span className="svcBadge" style={{ marginLeft: 6 }}>Tread-life</span> : null}
                  </td>
                  <td className="r">
                    <button
                      className="btn tiny"
                      onClick={(e) => {
                        e.stopPropagation();
                        setClaim(r);
                      }}
                    >
                      File claim
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="legalNote" style={{ marginTop: 12 }}>
          Road hazard runs {warrantyTerms(cfg).roadHazardMonths} months from the sale and a claim prorates by{" "}
          {warrantyTerms(cfg).roadHazardBasis === "time" ? "time left on the coverage" : "the tread still left on the tire"}; tread-life credit is the
          share of the tire's rated miles not yet driven. Change the terms under Settings → Departments &amp; signatures. Filing a claim opens a
          replacement ticket with the credit already on it.
        </p>
      </div>
      {claim && <ClaimModal record={claim} shop={shop} cfg={cfg} onClose={() => setClaim(null)} onNew={onNew} nav={nav} />}
    </>
  );
}

function ClaimModal({ record, shop, cfg, onClose, onNew }) {
  const now = Date.now();
  const terms = warrantyTerms(cfg);
  const st = warrantyStatus(record, cfg, now);
  const v = record.vehicleId && shop.vehicles[record.vehicleId];
  const c = record.customerId && shop.customers[record.customerId];

  const [tireIx, setTireIx] = useState(0);
  const tire = record.tires[tireIx] || record.tires[0];
  const canHazard = record.roadHazard && st.roadHazard.active;
  const canTread = !!(tire && tire.treadlifeMiles > 0);
  const [kind, setKind] = useState(canHazard ? "hazard" : canTread ? "treadlife" : "hazard");

  const [tread, setTread] = useState(""); // remaining tread, 32nds (road hazard, tread basis)
  const [miles, setMiles] = useState(v && v.mileage ? String(v.mileage) : ""); // current odometer (tread-life)

  const credit = useMemo(() => {
    if (!tire) return 0;
    if (kind === "treadlife") {
      const used = Math.max(0, toNum(miles) - record.mileage);
      return treadlifeCredit({ tirePrice: tire.price, warrantyMiles: tire.treadlifeMiles, milesUsed: used });
    }
    return roadHazardCredit({ tirePrice: tire.price, soldAt: record.at, now, cfg, remainingTread32: toNum(tread) });
  }, [tire, kind, tread, miles, record, cfg, now]);

  const start = () => {
    const line = {
      id: uid(),
      kind: "discount",
      description: claimLineLabel({ kind, fromNumber: record.number, size: tire.size }),
      details: kind === "treadlife" ? `Tread-life adjustment on ${tire.description}. ${Math.max(0, toNum(miles) - record.mileage).toLocaleString()} of ${tire.treadlifeMiles.toLocaleString()} rated miles used.` : `Road hazard claim on ${tire.description}, sold ${fmtDate(record.at)}.`,
      qty: 1,
      price: credit,
      warrantyClaim: { fromOrder: record.orderId, fromNumber: record.number, kind },
    };
    onNew({ customerId: record.customerId || null, vehicleId: record.vehicleId || null, dept: "tires", walkIn: true, lines: [line] });
    onClose();
  };

  return (
    <Modal title="Warranty claim" onClose={onClose} size="wide">
      <p className="legalNote" style={{ marginTop: 0 }}>
        {custLabel(c)} · {vehicleName(v) || "vehicle"} · invoice #{record.number}, sold {fmtDate(record.at)}
        {record.mileage ? ` at ${record.mileage.toLocaleString()} mi` : ""}.
      </p>

      {record.tires.length > 1 && (
        <Field label="Which tire">
          <select value={tireIx} onChange={(e) => setTireIx(Number(e.target.value))}>
            {record.tires.map((t, i) => (
              <option key={t.lineId || i} value={i}>
                {t.description} — {t.qty} × ${t.price.toFixed(2)}
              </option>
            ))}
          </select>
        </Field>
      )}

      <div className="seg" style={{ margin: "10px 0" }}>
        <button className={kind === "hazard" ? "on" : ""} disabled={!canHazard} onClick={() => setKind("hazard")}>
          Road hazard {canHazard ? "" : "(none)"}
        </button>
        <button className={kind === "treadlife" ? "on" : ""} disabled={!canTread} onClick={() => setKind("treadlife")}>
          Tread-life {canTread ? "" : "(none)"}
        </button>
      </div>

      {kind === "hazard" && !canHazard && <p className="fldErr">No active road-hazard coverage on this sale.</p>}
      {kind === "treadlife" && !canTread && <p className="fldErr">This tire has no tread-life (mileage) warranty on file.</p>}

      {kind === "hazard" && canHazard && terms.roadHazardBasis === "tread" && (
        <Field label={`Tread left (32nds, new ≈ ${terms.newTread32})`}>
          <Num value={tread} onChange={setTread} placeholder={String(terms.newTread32)} />
        </Field>
      )}
      {kind === "hazard" && canHazard && terms.roadHazardBasis === "time" && (
        <p className="legalNote" style={{ marginTop: 0 }}>Prorated by time left: {st.roadHazard.daysLeft} of {terms.roadHazardMonths * 30} days remaining.</p>
      )}
      {kind === "treadlife" && canTread && (
        <Field label="Current odometer">
          <Num value={miles} onChange={setMiles} placeholder={String(record.mileage || "")} />
        </Field>
      )}

      <div className="statRow" style={{ marginTop: 12 }}>
        <div className="stat">
          <span>Tire price</span>
          <strong>
            <Money v={tire ? tire.price : 0} />
          </strong>
        </div>
        <div className="stat">
          <span>Warranty credit</span>
          <strong style={{ color: "var(--accent)" }}>
            <Money v={credit} />
          </strong>
        </div>
      </div>

      <button className="btn primary lg full" style={{ marginTop: 12 }} disabled={credit <= 0} onClick={start}>
        {credit > 0 ? `Start replacement ticket with ${"$"}${credit.toFixed(2)} credit` : "No credit to apply"}
      </button>
      <p className="legalNote">Opens a new tire ticket for this vehicle with the credit on it. Add the replacement tire and any install work, then post as usual.</p>
    </Modal>
  );
}
