import { useState, useMemo } from "react";
import { Money, fmtDate, fmtPhone } from "./ui.jsx";
import { customerName, vehicleName } from "./useShop.js";
import { orderTotals, round2 } from "../lib/invoice.js";
import { dayKey, startOfWeek } from "../lib/time.js";
import { customerStats, oilIntervals, customerLtv, vehicleLtv, periodSpend, isOilChangeOrder } from "../lib/customerAnalytics.js";
import { isFleet, fleetReport, fleetName } from "../lib/fleet.js";
import { dueBack } from "../lib/dueBack.js";
import { tireRotationsDue } from "../lib/tireService.js";
import { editionDeptIds } from "../lib/edition.js";
import { throughput } from "../lib/lubeMetrics.js";
import { WinBack } from "./WinBack.jsx";

/* Customer analytics: who's new, who comes back, what a customer (or car) is
   worth, how often cars come in, and a fleet-account roll-up. Its own tab, with
   its own date range. Sales, commissions and inventory live on Reports. */

/* Show a name, else the phone, else "Walk-in" — imported cash customers often have no name. */
function custLabel(c) {
  const n = customerName(c);
  if (n && n !== "Unnamed") return n;
  const ph = c && (c.phone || c.phone2);
  return ph ? String(ph) : "Walk-in";
}

const presets = (weekStart) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const yearStart = new Date(today.getFullYear(), 0, 1);
  const ws = startOfWeek(today, weekStart);
  return {
    week: [ws, today],
    month: [monthStart, today],
    year: [yearStart, today],
  };
};

export function Analytics({ shop, cfg, nav, flash }) {
  const p = useMemo(() => presets(cfg.weekStart), [cfg.weekStart]);
  const hasFleet = useMemo(() => Object.values(shop.customers).some(isFleet), [shop.customers]);
  const [view, setView] = useState("customers"); // customers | fleet
  const [range, setRange] = useState("year");
  const [from, setFrom] = useState(dayKey(p.year[0]));
  const [to, setTo] = useState(dayKey(p.year[1]));
  const pick = (k) => {
    setRange(k);
    if (p[k]) {
      setFrom(dayKey(p[k][0]));
      setTo(dayKey(p[k][1]));
    }
  };
  const fromTs = new Date(from + "T00:00:00").getTime();
  const toTs = new Date(to + "T23:59:59.999").getTime();

  /* one normalized visit per invoiced order, fleet accounts left out (they get
     their own view). Imported LubeSoft invoices keep the real billed total in
     o.ls.total — use it so the money matches what was actually charged. */
  const visits = useMemo(
    () =>
      Object.values(shop.orders)
        .filter((o) => o.status === "invoiced" && o.invoicedAt && !isFleet(shop.customers[o.customerId]))
        .map((o) => {
          const recorded = o.ls && Number(o.ls.total);
          return {
            customerId: o.customerId,
            vehicleId: o.vehicleId,
            at: o.invoicedAt,
            total: recorded > 0 ? recorded : orderTotals(o, cfg, shop.customers[o.customerId]).total,
            miles: Number(o.mileageOut) || Number(o.mileageIn) || 0,
            isOil: isOilChangeOrder(o, shop.parts),
          };
        }),
    [shop.orders, shop.customers, shop.parts, cfg]
  );
  const customers = useMemo(() => customerStats(visits, fromTs, toTs), [visits, fromTs, toTs]);
  const oil = useMemo(() => oilIntervals(visits, fromTs, toTs), [visits, fromTs, toTs]);
  const ltv = useMemo(() => customerLtv(visits), [visits]); // all-time
  const vltv = useMemo(() => vehicleLtv(visits), [visits]); // all-time
  const carSpend = useMemo(() => periodSpend(visits, "vehicleId", fromTs, toTs), [visits, fromTs, toTs]);
  const fleet = useMemo(() => fleetReport(shop.orders, shop.customers, cfg, shop.parts, fromTs, toTs), [shop.orders, shop.customers, cfg, shop.parts, fromTs, toTs]);
  const tp = useMemo(() => throughput(visits, fromTs, toTs), [visits, fromTs, toTs]);
  /* due-back is "as of now", not tied to the date range */
  const due = useMemo(() => dueBack({ orders: shop.orders, vehicles: shop.vehicles, customers: shop.customers, parts: shop.parts, cfg }), [shop.orders, shop.vehicles, shop.customers, shop.parts, cfg]);
  const tireDue = useMemo(() => tireRotationsDue({ orders: shop.orders, vehicles: shop.vehicles, customers: shop.customers, cfg }), [shop.orders, shop.vehicles, shop.customers, cfg]);
  const deptIds = useMemo(() => editionDeptIds(cfg), [cfg]);
  const oilOn = deptIds.includes("oil");
  const tiresOn = deptIds.includes("tires");
  const avgTicketAll = useMemo(() => (visits.length ? round2(visits.reduce((a, v) => a + Number(v.total || 0), 0) / visits.length) : 0), [visits]);

  return (
    <>
      <header className="deskHead">
        <h1>Analytics</h1>
        <div className="seg">
          {[["customers", "Customers"], ["dueback", "Due back"], ["trends", "Trends"], ...(hasFleet ? [["fleet", "Fleet accounts"]] : [])].map(([k, label]) => (
            <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)}>
              {label}
            </button>
          ))}
        </div>
        <div className="grow" />
        <div className="seg">
          {[
            ["week", "This week"],
            ["month", "This month"],
            ["year", "This year"],
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
        {view === "customers" && <CustomersReport customers={customers} oil={oil} ltv={ltv} vltv={vltv} carSpend={carSpend} shop={shop} nav={nav} />}
        {view === "dueback" && (
          <>
            {oilOn && <DueBackReport due={due} avgTicket={avgTicketAll} shop={shop} cfg={cfg} nav={nav} flash={flash} />}
            {tiresOn && <RotationsReport due={tireDue} shop={shop} nav={nav} />}
            {!oilOn && !tiresOn && <DueBackReport due={due} avgTicket={avgTicketAll} shop={shop} cfg={cfg} nav={nav} flash={flash} />}
          </>
        )}
        {view === "trends" && <TrendsReport tp={tp} shop={shop} />}
        {view === "fleet" && <FleetReport data={fleet} shop={shop} nav={nav} />}
      </div>
    </>
  );
}

function CustomersReport({ customers, oil, ltv, vltv, carSpend, shop, nav }) {
  const [topBy, setTopBy] = useState("customers"); // customers | vehicles
  const months = (d) => (d ? ` (~${Math.round((d / 30.44) * 10) / 10} mo)` : "");
  const topLtv = ltv.rows.slice(0, 15);
  const topVeh = vltv.rows.slice(0, 15);
  return (
    <>
      <div className="statRow">
        <div className="stat">
          <span>New customers</span>
          <strong>{customers.newCount}</strong>
        </div>
        <div className="stat">
          <span>Of those, returned</span>
          <strong>
            {customers.newReturned}
            {customers.newCount ? <small style={{ color: "var(--muted)", fontWeight: 400 }}> · {customers.newReturnRate}%</small> : null}
          </strong>
        </div>
        <div className="stat">
          <span>Returning customers</span>
          <strong>{customers.returningCount}</strong>
        </div>
        <div className="stat">
          <span>Average ticket</span>
          <strong>
            <Money v={customers.avgTicket} />
          </strong>
        </div>
        <div className="stat">
          <span>Spent per car</span>
          <strong>
            <Money v={carSpend.perGroup} />
          </strong>
          <small style={{ color: "var(--muted)" }}>in this range · {carSpend.groups} cars</small>
        </div>
        <div className="stat">
          <span>Miles between oil changes</span>
          <strong>{oil.mileCount ? `${oil.avgMiles.toLocaleString()} mi` : "—"}</strong>
        </div>
        <div className="stat">
          <span>Time between oil changes</span>
          <strong>{oil.dayCount ? `${oil.avgDays} days${months(oil.avgDays)}` : "—"}</strong>
        </div>
        <div className="stat">
          <span>Lifetime value / customer</span>
          <strong>
            <Money v={ltv.ltv} />
          </strong>
          <small style={{ color: "var(--muted)" }}>all-time · median <Money v={ltv.medianLtv} /></small>
        </div>
        <div className="stat">
          <span>Lifetime value / car</span>
          <strong>
            <Money v={vltv.ltv} />
          </strong>
          <small style={{ color: "var(--muted)" }}>all-time · median <Money v={vltv.medianLtv} /></small>
        </div>
        <div className="stat">
          <span>Visits per car</span>
          <strong>{vltv.avgVisits}</strong>
          <small style={{ color: "var(--muted)" }}>all-time · over ~{vltv.avgLifespanDays} days</small>
        </div>
      </div>

      <div className="deskSplit">
        <div className="stack">
          <div className="card">
            <div className="cardHead">
              <h3>New customers in this range ({customers.newCount})</h3>
            </div>
            <table className="dk">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>First visit</th>
                  <th className="r">Visits</th>
                  <th className="r">Spent so far</th>
                  <th>Came back?</th>
                </tr>
              </thead>
              <tbody>
                {customers.newCustomers.length === 0 && (
                  <tr>
                    <td colSpan={5} className="emptyNote">
                      No new customers in this range.
                    </td>
                  </tr>
                )}
                {customers.newCustomers.map((c) => (
                  <tr key={c.customerId} className="row" onClick={() => nav.openCustomer(c.customerId)}>
                    <td>
                      <strong>{custLabel(shop.customers[c.customerId])}</strong>
                    </td>
                    <td className="muted">{fmtDate(c.firstAt)}</td>
                    <td className="r num">{c.visits}</td>
                    <td className="r num">
                      <Money v={c.lifetimeRevenue} />
                    </td>
                    <td>
                      {c.returned ? <span className="svcBadge done">Returned</span> : <span className="muted">Not yet</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="stack">
          <div className="card">
            <div className="cardHead">
              <h3>Top by lifetime value</h3>
              <div className="seg">
                <button className={topBy === "customers" ? "on" : ""} onClick={() => setTopBy("customers")}>
                  Customers
                </button>
                <button className={topBy === "vehicles" ? "on" : ""} onClick={() => setTopBy("vehicles")}>
                  Cars
                </button>
              </div>
            </div>
            <table className="dk">
              <thead>
                <tr>
                  <th>{topBy === "vehicles" ? "Vehicle" : "Customer"}</th>
                  <th className="r">Visits</th>
                  <th>Last visit</th>
                  <th className="r">Lifetime</th>
                </tr>
              </thead>
              <tbody>
                {topBy === "customers" &&
                  (topLtv.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="emptyNote">
                        No customer history yet.
                      </td>
                    </tr>
                  ) : (
                    topLtv.map((c) => (
                      <tr key={c.customerId} className="row" onClick={() => nav.openCustomer(c.customerId)}>
                        <td>
                          <strong>{custLabel(shop.customers[c.customerId])}</strong>
                        </td>
                        <td className="r num">{c.visits}</td>
                        <td className="muted">{fmtDate(c.lastAt)}</td>
                        <td className="r num">
                          <Money v={c.revenue} />
                        </td>
                      </tr>
                    ))
                  ))}
                {topBy === "vehicles" &&
                  (topVeh.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="emptyNote">
                        No vehicle history yet.
                      </td>
                    </tr>
                  ) : (
                    topVeh.map((v) => {
                      const veh = shop.vehicles[v.vehicleId];
                      return (
                        <tr key={v.vehicleId} className="row" onClick={() => veh && nav.openCustomer(veh.customerId)}>
                          <td>
                            <strong>{vehicleName(veh) || "Vehicle"}</strong>
                          </td>
                          <td className="r num">{v.visits}</td>
                          <td className="muted">{fmtDate(v.lastAt)}</td>
                          <td className="r num">
                            <Money v={v.revenue} />
                          </td>
                        </tr>
                      );
                    })
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <p className="legalNote" style={{ marginTop: 12 }}>
        New vs. returning, average ticket, and oil-change intervals cover the date range above. "Spent per car" is the money
        taken in during the range divided by the cars that came in. Lifetime value and visits per car are all-time across your
        whole book (a car's entire history, not just this range) — that's what makes them "lifetime," so they don't move with
        the dates. Click a row to open it. Fleet (house) accounts are left out of these numbers — they have their own tab.
      </p>
    </>
  );
}

function FleetReport({ data, shop, nav }) {
  return (
    <>
      <div className="statRow">
        <div className="stat">
          <span>Fleet revenue</span>
          <strong>
            <Money v={data.revenue} />
          </strong>
        </div>
        <div className="stat">
          <span>Fleet tickets</span>
          <strong>{data.tickets}</strong>
        </div>
        <div className="stat">
          <span>Active accounts</span>
          <strong>
            {data.activeAccounts}
            <small style={{ color: "var(--muted)", fontWeight: 400 }}> of {data.accounts}</small>
          </strong>
        </div>
        <div className="stat">
          <span>Average ticket</span>
          <strong>
            <Money v={data.tickets ? round2(data.revenue / data.tickets) : 0} />
          </strong>
        </div>
        <div className="stat">
          <span>Fleet discounts given</span>
          <strong>
            <Money v={data.discounts} />
          </strong>
        </div>
        <div className="stat">
          <span>Charged on account</span>
          <strong>
            <Money v={data.onAccount} />
          </strong>
        </div>
        <div className="stat">
          <span>Owed on account (all-time)</span>
          <strong style={data.outstanding > 0 ? { color: "var(--warn)" } : null}>
            <Money v={data.outstanding} />
          </strong>
        </div>
      </div>
      <div className="card">
        <div className="cardHead">
          <h3>Fleet accounts</h3>
        </div>
        <table className="dk">
          <thead>
            <tr>
              <th>Account</th>
              <th className="r">Tickets</th>
              <th className="r">Revenue</th>
              <th className="r">Discounts</th>
              <th>Last visit</th>
              <th className="r">Owed on account</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="emptyNote">
                  No fleet accounts yet. Flag a customer as a fleet account on their page.
                </td>
              </tr>
            )}
            {data.rows.map((f) => (
              <tr key={f.id} className="row" onClick={() => nav.openCustomer(f.id)}>
                <td>
                  <strong>{f.name || fleetName(shop.customers[f.id])}</strong>
                </td>
                <td className="r num">{f.tickets}</td>
                <td className="r num">
                  <Money v={f.revenue} />
                </td>
                <td className="r num muted">{f.discounts ? <Money v={f.discounts} /> : "—"}</td>
                <td className="muted">{f.last ? fmtDate(f.last) : "—"}</td>
                <td className="r num">{f.balance > 0.001 ? <Money v={f.balance} /> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="legalNote" style={{ marginTop: 12 }}>
        Revenue, tickets, discounts, and what was charged on account cover the date range above; "owed on account" is the
        all-time balance these accounts still owe. Click a row to open the account.
      </p>
    </>
  );
}

function agoText(days) {
  if (days >= 60) return `~${Math.round(days / 30.44)} mo`;
  if (days >= 14) return `~${Math.round(days / 7)} wk`;
  return `${days} day${days === 1 ? "" : "s"}`;
}

function DueBackReport({ due, avgTicket, shop, cfg, nav, flash }) {
  const list = [...due.overdue, ...due.soon].slice(0, 200);
  const potential = Math.round((due.overdue.length + due.soon.length) * (Number(avgTicket) || 0));
  const [winBack, setWinBack] = useState(false);
  const flashSafe = flash || (() => {});
  return (
    <>
      <div className="statRow">
        <div className="stat">
          <span>Overdue for an oil change</span>
          <strong style={due.overdue.length ? { color: "var(--warn)" } : null}>{due.overdue.length}</strong>
        </div>
        <div className="stat">
          <span>Due within 30 days</span>
          <strong>{due.soon.length}</strong>
        </div>
        <div className="stat">
          <span>Potential revenue</span>
          <strong>
            <Money v={potential} />
          </strong>
          <small style={{ color: "var(--muted)" }}>if they return · at <Money v={avgTicket} /> avg</small>
        </div>
        <div className="stat">
          <span>Lapsed</span>
          <strong>{due.lapsed.length}</strong>
          <small style={{ color: "var(--muted)" }}>quiet over 15 months</small>
        </div>
      </div>
      <div className="card">
        <div className="cardHead">
          <h3>Due back — call, text, or send a card ({due.overdue.length + due.soon.length})</h3>
          {due.overdue.length + due.soon.length > 0 && (
            <button className="btn primary" onClick={() => setWinBack(true)}>
              Win them back
            </button>
          )}
        </div>
        <table className="dk">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Phone</th>
              <th>Vehicle</th>
              <th>Last oil change</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={5} className="emptyNote">
                  No cars are due back right now.
                </td>
              </tr>
            )}
            {list.map((r) => {
              const c = shop.customers[r.customerId];
              const phone = c && (c.phone || c.phone2);
              return (
                <tr key={r.vehicleId} className="row" onClick={() => nav.openCustomer(r.customerId)}>
                  <td>
                    <strong>{custLabel(c)}</strong>
                  </td>
                  <td className="muted num">{phone ? fmtPhone(phone) : "—"}</td>
                  <td className="muted">{vehicleName(shop.vehicles[r.vehicleId]) || "—"}</td>
                  <td className="muted">
                    {fmtDate(r.lastAt)}
                    {r.lastMileage ? ` · ${r.lastMileage.toLocaleString()} mi` : ""}
                  </td>
                  <td>
                    {r.dueDays > 0 ? (
                      <span className="svcBadge due">overdue {agoText(r.dueDays)}</span>
                    ) : (
                      <span className="svcBadge soon">due in {-r.dueDays} days</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="legalNote" style={{ marginTop: 12 }}>
        Based on each car's last oil change and your reminder interval (Settings → reminder months/miles, or a car's own
        saved interval). "Lapsed" cars haven't been in for over 15 months. Click a row to open the customer and reach out.
        Fleet accounts are left out.
      </p>
      {winBack && (
        <WinBack shop={shop} cfg={cfg} rows={[...due.overdue, ...due.soon]} flash={flashSafe} onClose={() => setWinBack(false)} />
      )}
    </>
  );
}

/* Cars due for a tire rotation — the tire shop's win-back list. */
function RotationsReport({ due, shop, nav }) {
  const list = [...due.overdue, ...due.soon].slice(0, 200);
  return (
    <>
      <div className="statRow">
        <div className="stat">
          <span>Overdue for a rotation</span>
          <strong style={due.overdue.length ? { color: "var(--warn)" } : null}>{due.overdue.length}</strong>
        </div>
        <div className="stat">
          <span>Due within 30 days</span>
          <strong>{due.soon.length}</strong>
        </div>
        <div className="stat">
          <span>Lapsed</span>
          <strong>{due.lapsed.length}</strong>
          <small style={{ color: "var(--muted)" }}>quiet over 18 months</small>
        </div>
      </div>
      <div className="card">
        <div className="cardHead">
          <h3>Rotations due — call or text ({due.overdue.length + due.soon.length})</h3>
        </div>
        <table className="dk">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Phone</th>
              <th>Vehicle</th>
              <th>Last tire service</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={5} className="emptyNote">
                  No cars are due for a rotation right now.
                </td>
              </tr>
            )}
            {list.map((r) => {
              const c = shop.customers[r.customerId];
              const phone = c && (c.phone || c.phone2);
              return (
                <tr key={r.vehicleId} className="row" onClick={() => nav.openCustomer(r.customerId)}>
                  <td>
                    <strong>{custLabel(c)}</strong>
                  </td>
                  <td className="muted num">{phone ? fmtPhone(phone) : "—"}</td>
                  <td className="muted">{vehicleName(shop.vehicles[r.vehicleId]) || "—"}</td>
                  <td className="muted">
                    {fmtDate(r.lastAt)}
                    {r.lastMileage ? ` · ${r.lastMileage.toLocaleString()} mi` : ""}
                  </td>
                  <td>
                    {r.dueDays > 0 ? (
                      <span className="svcBadge due">overdue {agoText(r.dueDays)}</span>
                    ) : (
                      <span className="svcBadge soon">due in {-r.dueDays} days</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="legalNote" style={{ marginTop: 12 }}>
        Based on each car's last tire service and your rotation interval (Settings → Departments &amp; signatures → Tire warranties &amp; rotation).
        Click a row to open the customer and reach out. Fleet accounts are left out.
      </p>
    </>
  );
}

const monthLabel = (m) => {
  const [y, mo] = String(m).split("-");
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
};
const hourLabel = (h) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "a" : "p"}`;

function TrendsReport({ tp }) {
  const [selDay, setSelDay] = useState(null); // 0..6, or null for every day
  /* hour counts for the whole week, or just the clicked day */
  const hourCounts = selDay == null ? tp.hours.map((h) => h.count) : tp.hoursByDay[selDay] || new Array(24).fill(0);
  const hourPeak = Math.max(0, ...hourCounts);
  const hourRows = hourCounts.map((count, hour) => ({ hour, count, share: hourPeak ? Math.round((count / hourPeak) * 100) : 0 }));
  const withData = hourRows.filter((h) => h.count > 0);
  const hasHours = withData.length > 1;
  const lo = withData.length ? withData[0].hour : 7;
  const hi = withData.length ? withData[withData.length - 1].hour : 19;
  const shownHours = hasHours ? hourRows.slice(lo, hi + 1) : [];
  const selName = selDay != null ? tp.weekdays[selDay].day : "";
  return (
    <>
      <div className="statRow">
        <div className="stat">
          <span>Cars</span>
          <strong>{tp.cars}</strong>
          <small style={{ color: "var(--muted)" }}>in this range</small>
        </div>
        <div className="stat">
          <span>Tickets</span>
          <strong>{tp.tickets}</strong>
        </div>
        <div className="stat">
          <span>Cars per day</span>
          <strong>{tp.perDay}</strong>
          <small style={{ color: "var(--muted)" }}>over {tp.openDays} open days</small>
        </div>
        <div className="stat">
          <span>Busiest day</span>
          <strong>{tp.busiestDay}</strong>
        </div>
        <div className="stat">
          <span>Busiest hour</span>
          <strong>{tp.peakHour != null ? `${hourLabel(tp.peakHour)}–${hourLabel((tp.peakHour + 1) % 24)}` : "—"}</strong>
        </div>
        <div className="stat">
          <span>Revenue</span>
          <strong>
            <Money v={tp.revenue} />
          </strong>
        </div>
      </div>
      <div className="deskSplit">
        <div className="stack">
          <div className="card">
            <div className="cardHead">
              <h3>Cars by day of week</h3>
              <span className="muted" style={{ fontSize: 12 }}>Click a day to filter the hours →</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "4px 2px" }}>
              {tp.weekdays.map((w, i) => {
                const on = selDay === i;
                return (
                  <button
                    key={w.day}
                    type="button"
                    onClick={() => setSelDay(on ? null : i)}
                    title={`See ${w.day} hours`}
                    style={{ display: "flex", alignItems: "center", gap: 10, background: "transparent", border: "1px solid", borderColor: on ? "var(--signal)" : "transparent", borderRadius: 8, padding: "4px 6px", cursor: "pointer", width: "100%", textAlign: "left", font: "inherit" }}
                  >
                    <span style={{ width: 40, fontSize: 13, color: on ? "var(--signal)" : "var(--muted)", fontWeight: on ? 700 : 400 }}>{w.day}</span>
                    <div style={{ flex: 1, background: "var(--panel)", borderRadius: 6, height: 18, overflow: "hidden" }}>
                      <div style={{ width: `${w.share}%`, background: "var(--signal)", height: "100%" }} />
                    </div>
                    <span style={{ width: 46, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{w.count}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="card">
            <div className="cardHead">
              <h3>Cars by hour{selName ? ` · ${selName}` : ""}</h3>
              {selDay != null && (
                <button className="btn tiny" onClick={() => setSelDay(null)}>
                  All days
                </button>
              )}
            </div>
            {hasHours ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "4px 2px" }}>
                {shownHours.map((h) => (
                  <div key={h.hour} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 40, color: "var(--muted)", fontSize: 13 }}>{hourLabel(h.hour)}</span>
                    <div style={{ flex: 1, background: "var(--panel)", borderRadius: 6, height: 16, overflow: "hidden" }}>
                      <div style={{ width: `${h.share}%`, background: "var(--signal)", height: "100%" }} />
                    </div>
                    <span style={{ width: 46, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{h.count}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="legalNote" style={{ margin: "4px 2px" }}>
                {!tp.hasHourData
                  ? "No time-of-day on these visits yet — imported history only kept the date. This fills in as you ring up tickets in the app."
                  : `Not enough ${selName} visits in this range to chart by hour.`}
              </p>
            )}
          </div>
        </div>
        <div className="stack">
          <div className="card">
            <div className="cardHead">
              <h3>Month by month</h3>
            </div>
            <table className="dk">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="r">Cars</th>
                  <th className="r">Tickets</th>
                  <th className="r">Avg ticket</th>
                  <th className="r">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {tp.months.length === 0 && (
                  <tr>
                    <td colSpan={5} className="emptyNote">
                      No visits in this range.
                    </td>
                  </tr>
                )}
                {tp.months.map((m) => (
                  <tr key={m.month}>
                    <td>{monthLabel(m.month)}</td>
                    <td className="r num">{m.cars}</td>
                    <td className="r num">{m.tickets}</td>
                    <td className="r num muted">
                      <Money v={m.avgTicket} />
                    </td>
                    <td className="r num">
                      <Money v={m.revenue} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
