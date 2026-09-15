import { useState, useMemo } from "react";
import { Modal, Field, Text, toNum, ConfirmModal } from "./ui.jsx";
import { blankCoupon, couponValueText, couponRulesText } from "../lib/coupons.js";

/* Coupons and discounts. Every discount on a ticket comes from one of these —
   there's no free-typed discount anymore. Each coupon says how much it takes
   off and the rules for when it can be used: a date window, first-time
   customers only, a minimum ticket, and which services have to be on it. */

export function Coupons({ shop, cfg, flash }) {
  const [edit, setEdit] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [showRetired, setShowRetired] = useState(false);

  const rows = Object.values(shop.coupons || {})
    .filter((c) => !c.deleted && (showRetired ? c.active === false : c.active !== false))
    .sort((a, b) => (a.code || "").localeCompare(b.code || ""));
  const retiredCount = Object.values(shop.coupons || {}).filter((c) => !c.deleted && c.active === false).length;

  /* uses + total given, lifetime, from every ticket's discount lines */
  const stats = useMemo(() => {
    const by = {};
    for (const o of Object.values(shop.orders || {})) {
      if (o.status === "void" || o.status === "deleted") continue;
      for (const l of o.lines || []) {
        if (l.kind === "discount" && l.couponId) {
          const s = (by[l.couponId] = by[l.couponId] || { uses: 0, total: 0 });
          s.uses += 1;
          s.total += Number(l.qty || 1) * Number(l.price || 0);
        }
      }
    }
    return by;
  }, [shop.orders]);

  return (
    <>
      <header className="deskHead">
        <h1>Coupons &amp; discounts</h1>
        <div className="seg">
          <button className={!showRetired ? "on" : ""} onClick={() => setShowRetired(false)}>
            Active
          </button>
          <button className={showRetired ? "on" : ""} onClick={() => setShowRetired(true)}>
            Retired{retiredCount ? ` (${retiredCount})` : ""}
          </button>
        </div>
        <div className="grow" />
        <button className="btn primary" onClick={() => setEdit(blankCoupon())}>
          New coupon
        </button>
      </header>
      <div className="deskBody">
        <div className="tableCard">
          <table className="dk">
            <thead>
              <tr>
                <th>Code</th>
                <th>Discount</th>
                <th>Applies to</th>
                <th className="r">Times used</th>
                <th className="r">Given</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="emptyNote">
                    {showRetired ? "No retired coupons." : "No coupons yet. Create one for each promo you run so the counter can only apply approved discounts."}
                  </td>
                </tr>
              )}
              {rows.map((c) => {
                const s = stats[c.id] || { uses: 0, total: 0 };
                return (
                  <tr key={c.id} className="row" onClick={() => setEdit({ ...blankCoupon(), ...c })}>
                    <td>
                      <strong>{c.code || "—"}</strong>
                      {c.name ? <div className="sub muted">{c.name}</div> : null}
                    </td>
                    <td>{couponValueText(c)}</td>
                    <td className="muted">{couponRulesText(c)}</td>
                    <td className="r num">{s.uses}</td>
                    <td className="r num">${s.total.toFixed(2)}</td>
                    <td className="r">
                      <span className="rowActs">
                        {showRetired && (
                          <button
                            className="btn tiny"
                            onClick={async (e) => {
                              e.stopPropagation();
                              await shop.saveCoupon({ ...c, active: true });
                              flash(`${c.code} is active again`);
                            }}
                          >
                            Bring back
                          </button>
                        )}
                        <button
                          className="btn tiny danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            setToDelete(c);
                          }}
                        >
                          Delete
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="legalNote">
          The counter can't type in a discount by hand — every discount comes from a coupon here. On a ticket, the Coupon
          button shows only the coupons that fit what's on it. See use over any date range under Reports → Coupons.
        </p>
      </div>
      {toDelete && (
        <ConfirmModal
          title={`Delete ${toDelete.code || "this coupon"}?`}
          onClose={() => setToDelete(null)}
          onConfirm={async () => {
            await shop.saveCoupon({ ...toDelete, active: false, deleted: true });
            setToDelete(null);
            flash(`${toDelete.code || "Coupon"} deleted`, "out");
          }}
        >
          <p style={{ marginTop: 0 }}>Tickets that already used this coupon keep their discount. To hide it but keep it on file, retire it instead.</p>
        </ConfirmModal>
      )}
      {edit && (
        <CouponForm
          coupon={edit}
          shop={shop}
          cfg={cfg}
          onClose={() => setEdit(null)}
          onSave={async (c) => {
            await shop.saveCoupon(c);
            setEdit(null);
            flash("Coupon saved");
          }}
        />
      )}
    </>
  );
}

function CouponForm({ coupon, shop, cfg, onClose, onSave }) {
  const [d, setD] = useState(coupon);
  const [err, setErr] = useState("");
  const set = (k) => (v) => setD((x) => ({ ...x, [k]: v }));

  /* the shop's services, to scope a coupon to certain ones: oil packages first,
     then canned jobs, by the name that lands on a ticket line's `job`. */
  const services = useMemo(() => {
    const names = [];
    for (const p of cfg.oilPackages || []) if (p.name && !names.includes(p.name)) names.push(p.name);
    for (const j of Object.values(shop.jobs || {})) if (j.active !== false && !j.deleted && j.name && !names.includes(j.name)) names.push(j.name);
    return names;
  }, [cfg.oilPackages, shop.jobs]);

  const toggleService = (name) =>
    setD((x) => {
      const has = (x.requireAny || []).includes(name);
      return { ...x, requireAny: has ? x.requireAny.filter((n) => n !== name) : [...(x.requireAny || []), name] };
    });

  const clean = (v) => String(v).replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");

  return (
    <Modal title={d.id ? "Edit coupon" : "New coupon"} onClose={onClose} size="wide">
      <div className="fldRow">
        <Field label="Code (short, e.g. FIRST20)">
          <Text value={d.code} onChange={(v) => set("code")(v.toUpperCase().replace(/\s+/g, ""))} autoFocus placeholder="FIRST20" />
        </Field>
        <Field label="Name (prints on the ticket)">
          <Text value={d.name} onChange={set("name")} placeholder="20% off your first visit" />
        </Field>
      </div>

      <div className="fldRow">
        <Field label="Discount type">
          <select value={d.kind} onChange={(e) => set("kind")(e.target.value)}>
            <option value="percent">Percent off</option>
            <option value="amount">Dollar amount off</option>
          </select>
        </Field>
        <Field label={d.kind === "amount" ? "Dollars off" : "Percent off"}>
          <Text value={d.value == null ? "" : String(d.value)} onChange={(v) => set("value")(clean(v))} inputMode="decimal" placeholder={d.kind === "amount" ? "10.00" : "20"} />
        </Field>
      </div>

      <div className="subhead">When can it be used?</div>
      <label className="fld inline">
        <input type="checkbox" checked={!!d.firstTimeOnly} onChange={(e) => set("firstTimeOnly")(e.target.checked)} />
        <span>First-time customers only (no prior invoices)</span>
      </label>
      <div className="fldRow">
        <Field label="Valid from (optional)">
          <input type="date" value={d.startsAt || ""} onChange={(e) => set("startsAt")(e.target.value)} />
        </Field>
        <Field label="Valid until (optional)">
          <input type="date" value={d.endsAt || ""} onChange={(e) => set("endsAt")(e.target.value)} />
        </Field>
        <Field label="Minimum ticket $ (optional)">
          <Text value={d.minSubtotal ? String(d.minSubtotal) : ""} onChange={(v) => set("minSubtotal")(clean(v))} inputMode="decimal" placeholder="0.00" />
        </Field>
      </div>

      <div className="subhead">Which services?</div>
      <p className="legalNote" style={{ marginTop: 0 }}>
        Leave all unchecked to let this coupon apply to any ticket. Check services to require at least one of them on the ticket.
      </p>
      <div className="svcPick">
        {services.length === 0 && <p className="muted" style={{ margin: 0 }}>No oil packages or canned jobs yet.</p>}
        {services.map((name) => (
          <label key={name} className={`svcChip ${(d.requireAny || []).includes(name) ? "on" : ""}`}>
            <input type="checkbox" checked={(d.requireAny || []).includes(name)} onChange={() => toggleService(name)} />
            <span>{name}</span>
          </label>
        ))}
      </div>
      {d.kind === "percent" && (d.requireAny || []).length > 0 && (
        <Field label="Take the percent off">
          <select value={d.applyTo} onChange={(e) => set("applyTo")(e.target.value)}>
            <option value="ticket">The whole ticket</option>
            <option value="eligible">Just the services above</option>
          </select>
        </Field>
      )}

      {d.id && (
        <label className="fld inline" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={d.active === false} onChange={(e) => set("active")(!e.target.checked)} />
          <span>Retire this coupon</span>
        </label>
      )}
      {err && <p className="fldErr">{err}</p>}
      <button
        className="btn primary lg full"
        onClick={() => {
          if (!d.code.trim()) return setErr("Give the coupon a code.");
          if (!(toNum(d.value) > 0)) return setErr("Enter how much it takes off.");
          if (d.kind === "percent" && toNum(d.value) > 100) return setErr("A percent can't be over 100.");
          onSave({
            ...d,
            code: d.code.trim(),
            name: d.name.trim(),
            value: toNum(d.value),
            minSubtotal: toNum(d.minSubtotal),
          });
        }}
      >
        Save coupon
      </button>
    </Modal>
  );
}
