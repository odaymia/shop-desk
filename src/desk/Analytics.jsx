import { useState, useMemo } from "react";
import { Money, fmtDate } from "./ui.jsx";
import { customerName, vehicleName } from "./useShop.js";
import { orderTotals, round2 } from "../lib/invoice.js";
import { dayKey, startOfWeek } from "../lib/time.js";
import { customerStats, oilIntervals, customerLtv, vehicleLtv, periodSpend, isOilChangeOrder } from "../lib/customerAnalytics.js";
import { isFleet, fleetReport, fleetName } from "../lib/fleet.js";

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

export function Analytics({ shop, cfg, nav }) {
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

  return (
    <>
      <header className="deskHead">
        <h1>Analytics</h1>
        <div className="seg">
          {[["customers", "Customers"], ...(hasFleet ? [["fleet", "Fleet accounts"]] : [])].map(([k, label]) => (
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
