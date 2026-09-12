import { useState, useMemo } from "react";
import { Money, fmtDate } from "./ui.jsx";
import { customerName, vehicleName } from "./useShop.js";
import { orderTotals, laborHours, lineAmount, round2 } from "../lib/invoice.js";
import { salesByItem, reorderPlan } from "../lib/inventoryReports.js";
import { searchText } from "./useShop.js";
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
  const [view, setView] = useState("sales"); // sales | items | reorder
  const [range, setRange] = useState("month");
  const [from, setFrom] = useState(dayKey(p.month[0]));
  const [to, setTo] = useState(dayKey(p.month[1]));
  const [coverDays, setCoverDays] = useState(14);
  const [leadDays, setLeadDays] = useState(0);
  const [itemQ, setItemQ] = useState("");
  const [cat, setCat] = useState("all");
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
      if (o.status === "void" || o.status === "deleted") continue;
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

  const items = useMemo(() => salesByItem(shop.orders, shop.parts, fromTs, toTs), [shop.orders, shop.parts, fromTs, toTs]);
  const reorder = useMemo(() => reorderPlan(shop.orders, shop.parts, fromTs, toTs, coverDays, leadDays), [shop.orders, shop.parts, fromTs, toTs, coverDays, leadDays]);
  const cats = useMemo(() => [...new Set(items.map((it) => it.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [items]);
  const itemRows = useMemo(() => items.filter((it) => (cat === "all" || it.category === cat) && searchText(itemQ, it.number, it.description, it.category)), [items, itemQ, cat]);
  const reorderRows = useMemo(() => reorder.filter((it) => (cat === "all" || it.category === cat) && searchText(itemQ, it.number, it.description, it.category)), [reorder, itemQ, cat]);

  const techName = (id) => (id === "none" ? "No tech assigned" : (employees.find((e) => e.id === id) || {}).name || "Unknown");
  const avg = r.count ? round2(r.sales / r.count) : 0;

  return (
    <>
      <header className="deskHead">
        <h1>Reports</h1>
        <div className="seg">
          {[
            ["sales", "Sales summary"],
            ["items", "Sales by item"],
            ["reorder", "Reorder planner"],
          ].map(([k, label]) => (
            <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)}>
              {label}
            </button>
          ))}
        </div>
        <div className="grow" />
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
        {view === "items" && <ItemsReport rows={itemRows} q={itemQ} setQ={setItemQ} cats={cats} cat={cat} setCat={setCat} />}
        {view === "reorder" && <ReorderReport rows={reorderRows} q={itemQ} setQ={setItemQ} cats={cats} cat={cat} setCat={setCat} coverDays={coverDays} setCoverDays={setCoverDays} leadDays={leadDays} setLeadDays={setLeadDays} from={from} to={to} />}
        {view === "sales" && (
        <>
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
        </>
        )}
      </div>
    </>
  );
}

function CategoryBar({ cats, cat, setCat }) {
  if (!cats.length) return null;
  return (
    <div className="catBar">
      <button className={`btn tiny ${cat === "all" ? "primary" : ""}`} onClick={() => setCat("all")}>
        All
      </button>
      {cats.map((c) => (
        <button key={c} className={`btn tiny ${cat === c ? "primary" : ""}`} onClick={() => setCat(c)}>
          {c}
        </button>
      ))}
    </div>
  );
}

function ItemsReport({ rows, q, setQ, cats, cat, setCat }) {
  const totals = rows.reduce((a, r) => ({ qty: a.qty + r.qty, revenue: a.revenue + r.revenue, profit: a.profit + r.profit }), { qty: 0, revenue: 0, profit: 0 });
  return (
    <div className="card">
      <div className="cardHead">
        <h3>Sales by item</h3>
        <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by item, part #, category" />
      </div>
      <CategoryBar cats={cats} cat={cat} setCat={setCat} />
      <table className="dk">
        <thead>
          <tr>
            <th>Item</th>
            <th>Category</th>
            <th className="r">Qty sold</th>
            <th className="r">Revenue</th>
            <th className="r">Cost</th>
            <th className="r">Profit</th>
            <th className="r">On hand</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="emptyNote">
                Nothing sold in this range.
              </td>
            </tr>
          )}
          {rows.map((it) => (
            <tr key={it.key}>
              <td>
                {it.number ? <span className="num muted">{it.number} </span> : null}
                {it.description || "—"}
              </td>
              <td className="muted">{it.category || "—"}</td>
              <td className="r num">{it.qty}</td>
              <td className="r num">
                <Money v={it.revenue} />
              </td>
              <td className="r num muted">
                <Money v={it.cost} />
              </td>
              <td className="r num">
                <Money v={it.profit} />
              </td>
              <td className="r num muted">{it.onHand == null ? "—" : it.onHand}</td>
            </tr>
          ))}
          {rows.length > 0 && (
            <tr className="job">
              <td colSpan={2}>Total</td>
              <td className="r num">{round2(totals.qty)}</td>
              <td className="r num">
                <Money v={round2(totals.revenue)} />
              </td>
              <td></td>
              <td className="r num">
                <Money v={round2(totals.profit)} />
              </td>
              <td></td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ReorderReport({ rows, q, setQ, cats, cat, setCat, coverDays, setCoverDays, leadDays, setLeadDays, from, to }) {
  const toOrder = rows.filter((r) => r.suggestedOrder > 0);
  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <p className="legalNote" style={{ margin: 0 }}>
          Order enough of each item to last while the order ships plus the days you choose to cover, based on how fast
          it sold from {from} to {to} and what you have on hand. Pick a wider date range for a steadier average.
        </p>
        <div className="dateRow" style={{ marginTop: 10 }}>
          <span>Days until the order arrives</span>
          <input type="number" min="0" className="search" style={{ width: 80 }} value={leadDays} onChange={(e) => setLeadDays(Math.max(0, Number(e.target.value) || 0))} />
          {[0, 2, 5, 7].map((d) => (
            <button key={d} className={`btn tiny ${Number(leadDays) === d ? "primary" : ""}`} onClick={() => setLeadDays(d)}>
              {d}d
            </button>
          ))}
        </div>
        <div className="dateRow" style={{ marginTop: 8 }}>
          <span>Days to cover after it arrives</span>
          <input type="number" min="1" className="search" style={{ width: 80 }} value={coverDays} onChange={(e) => setCoverDays(Math.max(1, Number(e.target.value) || 1))} />
          {[7, 14, 30, 60].map((d) => (
            <button key={d} className={`btn tiny ${Number(coverDays) === d ? "primary" : ""}`} onClick={() => setCoverDays(d)}>
              {d} days
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="cardHead">
          <h3>Reorder planner — {toOrder.length} item{toOrder.length === 1 ? "" : "s"} to order</h3>
          <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by item, part #, category" />
        </div>
        <CategoryBar cats={cats} cat={cat} setCat={setCat} />
        <table className="dk">
          <thead>
            <tr>
              <th>Item</th>
              <th className="r">On hand</th>
              <th className="r">Sold</th>
              <th className="r">Per week</th>
              <th className="r">Runs out in</th>
              <th className="r">Need</th>
              <th className="r">Order</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="emptyNote">
                  Nothing sold in this range to base an order on.
                </td>
              </tr>
            )}
            {rows.map((it) => (
              <tr key={it.partId} className={it.suggestedOrder > 0 ? "" : "off"}>
                <td>
                  {it.number ? <span className="num muted">{it.number} </span> : null}
                  {it.description || "—"}
                </td>
                <td className="r num">{it.onHand}</td>
                <td className="r num">{it.sold}</td>
                <td className="r num">{it.perWeek}</td>
                <td className="r num" style={it.stockOutBeforeArrival ? { color: "var(--warn)", fontWeight: 600 } : { color: "var(--muted)" }} title={it.stockOutBeforeArrival ? "Runs out before the order arrives" : ""}>
                  {it.daysLeft == null ? "—" : `${it.daysLeft}d`}
                  {it.stockOutBeforeArrival ? <span className="sub">before it arrives</span> : null}
                </td>
                <td className="r num">{it.need}</td>
                <td className="r num">
                  {it.suggestedOrder > 0 ? (
                    <strong style={{ color: "var(--signal)" }}>{it.orderText}</strong>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
