import { useState, useMemo } from "react";
import { Money, fmtDate, fmtTime } from "./ui.jsx";
import { customerName, vehicleName, searchText, isLive } from "./useShop.js";
import { orderTotals, owesBalance, STATUS } from "../lib/invoice.js";
import { workSummary } from "./Customers.jsx";
import { DeptTags } from "./Orders.jsx";

/* Posted invoices that still owe money, oldest first — what the cashier
   collects. Imported history can't owe a balance, so it's skipped without
   pricing it. Remembered per (orders, customers, cfg) so the count in the
   side menu costs nothing on re-renders. */
let memo = { orders: null, customers: null, cfg: null, out: [] };
export function dueOrders(shop, cfg) {
  if (memo.orders === shop.orders && memo.customers === shop.customers && memo.cfg === cfg) return memo.out;
  const out = [];
  for (const o of Object.values(shop.orders || {})) {
    if (!isLive(o) || o.imported || o.status !== STATUS.invoiced) continue;
    const c = shop.customers[o.customerId];
    const t = orderTotals(o, cfg, c);
    if (owesBalance(o, t)) out.push({ o, c, t });
  }
  out.sort((a, b) => (a.o.invoicedAt || 0) - (b.o.invoicedAt || 0));
  memo = { orders: shop.orders, customers: shop.customers, cfg, out };
  return out;
}

/* The cashier's screen: every invoice waiting on payment, with a Take
   payment button that opens the ticket straight to the payment window. */
export function Cashier({ shop, cfg, nav }) {
  const [q, setQ] = useState("");
  const all = dueOrders(shop, cfg);
  const rows = useMemo(
    () =>
      all
        .map((r) => ({ ...r, v: shop.vehicles[r.o.vehicleId] }))
        .filter(({ o, c, v }) => searchText(q, `#${o.number}`, String(o.number), customerName(c), c && c.phone, vehicleName(v), v && v.plate)),
    [all, q, shop.vehicles]
  );
  const owed = all.reduce((n, r) => n + r.t.balance, 0);
  const startOfDay = new Date().setHours(0, 0, 0, 0);

  return (
    <>
      <header className="deskHead">
        <h1>Cashier</h1>
        <span className="muted" style={{ fontVariantNumeric: "tabular-nums" }}>
          {all.length ? (
            <>
              {all.length} waiting · <Money v={owed} /> to collect
            </>
          ) : (
            "Nothing waiting"
          )}
        </span>
        <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticket #, name, plate" />
      </header>
      <div className="deskBody">
        <div className="tableCard scroll">
          <table className="dk cashierTable">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Sent</th>
                <th>Customer</th>
                <th>Vehicle</th>
                <th>Work</th>
                <th className="r">Total</th>
                <th className="r">Owes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="emptyNote">
                    {q ? "Nothing matches." : "No one is waiting to pay. Oil changes land here when they're sent to the cashier, and any posted invoice with a balance shows up too."}
                  </td>
                </tr>
              )}
              {rows.map(({ o, c, v, t }) => (
                <tr key={o.id} className="row" onClick={() => nav.openOrder(o.id, { pay: true })}>
                  <td>
                    <strong>#{o.number}</strong>
                  </td>
                  <td className="muted">{(o.invoicedAt || 0) >= startOfDay ? fmtTime(o.invoicedAt) : fmtDate(o.invoicedAt)}</td>
                  <td>{customerName(c)}</td>
                  <td className="muted">
                    {vehicleName(v)}
                    {v && v.plate ? <span className="sub">{v.plate}</span> : null}
                  </td>
                  <td className="muted">
                    {workSummary(o)}
                    <DeptTags order={o} parts={shop.parts} />
                  </td>
                  <td className="r num">
                    <Money v={t.total} />
                  </td>
                  <td className="r num">
                    <strong>
                      <Money v={t.balance} />
                    </strong>
                    {t.paid > 0 ? <span className="sub">paid <Money v={t.paid} /></span> : null}
                  </td>
                  <td className="r">
                    <button
                      className="btn primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        nav.openOrder(o.id, { pay: true });
                      }}
                    >
                      Take payment
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
