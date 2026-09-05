import { useState, useMemo } from "react";
import { Money, fmtDate } from "./ui.jsx";
import { customerName, vehicleName } from "./useShop.js";
import { orderTotals, laborHours, lineAmount, round2 } from "../lib/invoice.js";
import { dayKey, startOfWeek } from "../lib/time.js";

const presets = (weekStart) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  const ws = startOfWeek(today, weekStart);
  return {
    today: [today, today],
    week: [ws, today],
    month: [monthStart, today],
    lastMonth: [lastMonthStart, lastMonthEnd],
  };
};

export function Reports({ shop, cfg, employees, nav }) {
  const p = useMemo(() => presets(cfg.weekStart), [cfg.weekStart]);
  const [range, setRange] = useState("month");
  const [from, setFrom] = useState(dayKey(p.month[0]));
  const [to, setTo] = useState(dayKey(p.month[1]));
  const pick = (k) => {
    setRange(k);
    if (p[k]) {
      setFrom(dayKey(p[k][0]));
      setTo(dayKey(p[k][1]));
    }
  };
  const fromTs = new Date(from + "T00:00:00").getTime();
  const toTs = new Date(to + "T23:59:59.999").getTime();

  const r = useMemo(() => {
    const inv = Object.values(shop.orders)
      .filter((o) => o.status === "invoiced" && o.invoicedAt >= fromTs && o.invoicedAt <= toTs)
      .map((o) => ({ o, t: orderTotals(o, cfg, shop.customers[o.customerId]) }))
      .sort((a, b) => b.o.invoicedAt - a.o.invoicedAt);
    const sum = (f) => round2(inv.reduce((a, x) => a + f(x), 0));
    const byMethod = {};
    let collected = 0;
    for (const o of Object.values(shop.orders)) {
      if (o.status === "void") continue;
      for (const pay of o.payments || []) {
        if (pay.at >= fromTs && pay.at <= toTs) {
          byMethod[pay.method] = round2((byMethod[pay.method] || 0) + Number(pay.amount || 0));
          collected += Number(pay.amount || 0);
        }
      }
    }
    const byTech = {};
    for (const { o } of inv)
      for (const l of o.lines || []) {
        if (l.kind !== "labor") continue;
        const k = l.techId || "none";
        byTech[k] = byTech[k] || { hours: 0, amount: 0, tickets: new Set() };
        byTech[k].hours = round2(byTech[k].hours + Number(l.hours || 0));
        byTech[k].amount = round2(byTech[k].amount + lineAmount(l));
        byTech[k].tickets.add(o.id);
      }
    const outstanding = Object.values(shop.orders)
      .filter((o) => o.status === "invoiced")
      .reduce((a, o) => a + Math.max(0, orderTotals(o, cfg, shop.customers[o.customerId]).balance), 0);
    return {
      inv,
      count: inv.length,
      sales: sum((x) => x.t.total),
      parts: sum((x) => x.t.parts),
      labor: sum((x) => x.t.labor),
      sublet: sum((x) => x.t.sublet),
      fees: sum((x) => x.t.fees + x.t.supplies),
      discounts: sum((x) => x.t.discounts),
      tax: sum((x) => x.t.tax),
      taxable: sum((x) => x.t.taxable),
      cost: sum((x) => x.t.cost),
      profit: sum((x) => x.t.profit),
      hours: sum((x) => laborHours(x.o)),
      byMethod,
      collected: round2(collected),
      byTech,
      outstanding: round2(outstanding),
    };
  }, [shop.orders, shop.customers, cfg, fromTs, toTs]);

  const techName = (id) => (id === "none" ? "No tech assigned" : (employees.find((e) => e.id === id) || {}).name || "Unknown");
  const avg = r.count ? round2(r.sales / r.count) : 0;

  return (
    <>
      <header className="deskHead">
        <h1>Reports</h1>
        <div className="seg">
          {[
            ["today", "Today"],
            ["week", "This week"],
            ["month", "This month"],
            ["lastMonth", "Last month"],
            ["custom", "Custom"],
          ].map(([k, label]) => (
            <button key={k} className={range === k ? "on" : ""} onClick={() => pick(k)}>
              {label}
            </button>
          ))}
        </div>
        <div className="dateRow">
          <input type="date" value={from} onChange={(e) => (setRange("custom"), setFrom(e.target.value))} />
          <span className="muted">to</span>
          <input type="date" value={to} onChange={(e) => (setRange("custom"), setTo(e.target.value))} />
        </div>
      </header>
      <div className="deskBody">
        <div className="statRow">
          <div className="stat">
            <span>Sales</span>
            <strong>
              <Money v={r.sales} />
            </strong>
          </div>
          <div className="stat">
            <span>Invoices</span>
            <strong>{r.count}</strong>
          </div>
          <div className="stat">
            <span>Average ticket</span>
            <strong>
              <Money v={avg} />
            </strong>
          </div>
          <div className="stat">
            <span>Collected</span>
            <strong>
              <Money v={r.collected} />
            </strong>
          </div>
          <div className="stat">
            <span>Sales tax collected</span>
            <strong>
              <Money v={r.tax} />
            </strong>
          </div>
          <div className="stat">
            <span>Owed to you (all time)</span>
            <strong style={r.outstanding > 0 ? { color: "var(--warn)" } : null}>
              <Money v={r.outstanding} />
            </strong>
          </div>
        </div>

        <div className="deskSplit">
          <div className="stack">
            <div className="card">
              <div className="cardHead">
                <h3>Sales breakdown</h3>
              </div>
              <div className="totals">
                <div>
                  <span>Parts</span>
                  <Money v={r.parts} />
                </div>
                <div>
                  <span>Labor ({r.hours} hrs billed)</span>
                  <Money v={r.labor} />
                </div>
                <div>
                  <span>Sublet</span>
                  <Money v={r.sublet} />
                </div>
                <div>
                  <span>Fees and shop supplies</span>
                  <Money v={r.fees} />
                </div>
                <div>
                  <span>Discounts</span>
                  <Money v={-r.discounts} />
                </div>
                <div>
                  <span>Taxable sales</span>
                  <Money v={r.taxable} />
                </div>
                <div>
                  <span>Sales tax</span>
                  <Money v={r.tax} />
                </div>
                <div className="grand">
                  <span>Total</span>
                  <Money v={r.sales} />
                </div>
                <div>
                  <span>Parts and sublet cost</span>
                  <Money v={-r.cost} />
                </div>
                <div>
                  <span>Gross profit before labor cost</span>
                  <Money v={r.profit} />
                </div>
              </div>
            </div>
            <div className="card">
              <div className="cardHead">
                <h3>Invoices in this range</h3>
              </div>
              <table className="dk">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Vehicle</th>
                    <th className="r">Total</th>
                    <th className="r">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {r.inv.length === 0 && (
                    <tr>
                      <td colSpan={6} className="emptyNote">
                        No invoices posted in this range.
                      </td>
                    </tr>
                  )}
                  {r.inv.map(({ o, t }) => (
                    <tr key={o.id} className="row" onClick={() => nav.openOrder(o.id)}>
                      <td>
                        <strong>#{o.number}</strong>
                      </td>
                      <td className="muted">{fmtDate(o.invoicedAt)}</td>
                      <td>{customerName(shop.customers[o.customerId])}</td>
                      <td className="muted">{vehicleName(shop.vehicles[o.vehicleId])}</td>
                      <td className="r num">
                        <Money v={t.total} />
                      </td>
                      <td className="r num">{t.balance > 0.001 ? <Money v={t.balance} /> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="stack">
            <div className="card">
              <div className="cardHead">
                <h3>Payments by method</h3>
              </div>
              <div className="totals">
                {Object.keys(r.byMethod).length === 0 && <div className="muted">No payments in this range.</div>}
                {Object.entries(r.byMethod).map(([m, v]) => (
                  <div key={m}>
                    <span style={{ textTransform: "capitalize" }}>{m}</span>
                    <Money v={v} />
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <div className="cardHead">
                <h3>Labor by technician</h3>
              </div>
              <div className="totals">
                {Object.keys(r.byTech).length === 0 && <div className="muted">No labor billed in this range.</div>}
                {Object.entries(r.byTech)
                  .sort((a, b) => b[1].amount - a[1].amount)
                  .map(([id, v]) => (
                    <div key={id}>
                      <span>
                        {techName(id)} · {v.hours} hrs · {v.tickets.size} tickets
                      </span>
                      <Money v={v.amount} />
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
