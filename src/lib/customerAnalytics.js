/* Customer analytics for the Reports tab: new vs. returning customers, how
   many new customers came back, average ticket, how often cars come in for an
   oil change (miles and days between visits), and customer lifetime value.

   Works on a plain list of "visits" the Reports screen builds from invoiced
   orders — { customerId, vehicleId, at, total, miles, isOil } — so this stays
   pure (no React, no storage, no orderTotals) and easy to test. */
import { round2 } from "./invoice.js";

const DAY = 86400000;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/* Does an order look like an oil-change / lube visit? Catches our own tickets
   (the oil flag), and the many ways imported LubeSoft history names one —
   "Full service oil change", "Basic service", "Signature service", a synthetic
   or conventional oil change, a plain lube, or any line that sold engine oil.
   Deliberately broad: for a quick lube nearly every repeat visit is an oil
   change, and the mile/day sanity limits downstream drop anything odd. */
const OIL_TEXT = /oil change|oil & filter|oil and filter|full service|basic service|signature service|\blof\b|\blube\b|synthetic.{0,12}oil|conventional.{0,12}oil|high.?mileage.{0,12}oil|\boil\b.{0,14}(service|change|lube)|(service|change|lube).{0,14}\boil\b/i;
export function isOilChangeOrder(order, parts) {
  const lines = (order && order.lines) || [];
  return lines.some((l) => {
    if (l.oil) return true;
    if (OIL_TEXT.test(`${l.job || ""} ${l.description || ""}`)) return true;
    const p = l.partId && parts && parts[l.partId];
    return !!(p && /^oil$/i.test(String((p && p.category) || "")));
  });
}

/* Group visits by a key (customerId / vehicleId), each group sorted oldest
   first; blank keys are dropped. */
function groupBy(visits, key) {
  const m = new Map();
  for (const v of visits || []) {
    const k = v && v[key];
    if (k == null || k === "") continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(v);
  }
  for (const arr of m.values()) arr.sort((a, b) => a.at - b.at);
  return m;
}

/* New vs. returning customers in [fromTs, toTs], and the average ticket over
   the visits in that window. A customer is "new" when their very first visit
   (ever) lands in the window; "returned" when a new customer has come back at
   least once. "Returning" customers were acquired earlier but came in during
   the window. */
export function customerStats(visits, fromTs, toTs) {
  const byCust = groupBy(visits, "customerId");
  let newCount = 0;
  let newReturned = 0;
  let returningCount = 0;
  let activeCount = 0;
  let periodRevenue = 0;
  let periodVisits = 0;
  const newCustomers = [];
  for (const [cid, vs] of byCust) {
    const firstAt = vs[0].at;
    const inRange = vs.filter((v) => v.at >= fromTs && v.at <= toTs);
    if (inRange.length) {
      activeCount += 1;
      periodVisits += inRange.length;
      for (const v of inRange) periodRevenue += num(v.total);
    }
    const isNew = firstAt >= fromTs && firstAt <= toTs;
    if (isNew) {
      newCount += 1;
      const returned = vs.length > 1;
      if (returned) newReturned += 1;
      newCustomers.push({
        customerId: cid,
        firstAt,
        lastAt: vs[vs.length - 1].at,
        visits: vs.length,
        lifetimeRevenue: round2(vs.reduce((a, v) => a + num(v.total), 0)),
        returned,
      });
    } else if (inRange.length) {
      returningCount += 1;
    }
  }
  newCustomers.sort((a, b) => b.firstAt - a.firstAt);
  return {
    newCount,
    newReturned,
    newReturnRate: newCount ? Math.round((newReturned / newCount) * 100) : 0,
    returningCount,
    activeCount,
    periodVisits,
    periodRevenue: round2(periodRevenue),
    avgTicket: periodVisits ? round2(periodRevenue / periodVisits) : 0,
    newCustomers,
  };
}

/* How far apart a car's oil changes are — miles and days between one oil
   change and the next. An interval counts when the later of the two visits
   falls in [fromTs, toTs] (pass null for all time). Nonsense gaps are dropped
   (under a week or over two years; under 500 or over 30,000 miles) so one bad
   odometer entry doesn't skew the average. */
export function oilIntervals(visits, fromTs = null, toTs = null) {
  const byVeh = groupBy((visits || []).filter((v) => v.isOil), "vehicleId");
  const dayDeltas = [];
  const mileDeltas = [];
  for (const vs of byVeh.values()) {
    for (let i = 1; i < vs.length; i++) {
      const later = vs[i];
      const prev = vs[i - 1];
      if (fromTs != null && !(later.at >= fromTs && later.at <= toTs)) continue;
      const days = (later.at - prev.at) / DAY;
      if (days >= 7 && days <= 730) dayDeltas.push(days);
      const miles = num(later.miles) - num(prev.miles);
      if (miles >= 500 && miles <= 30000) mileDeltas.push(miles);
    }
  }
  return {
    avgDays: Math.round(mean(dayDeltas)),
    avgMiles: Math.round(mean(mileDeltas)),
    dayCount: dayDeltas.length,
    mileCount: mileDeltas.length,
  };
}

/* Lifetime value grouped by a key (customer or vehicle): average and median
   total spend, average visits and lifespan, plus a per-group table sorted by
   spend. Spend and visits are always the group's whole history (that's what
   "lifetime" means), but when a range is given it covers only the groups active
   during that range — so the numbers respond to the date picker without
   stopping being lifetime figures. No range = every group. */
function ltvBy(visits, key, fromTs, toTs) {
  const groups = groupBy(visits, key);
  let totalRev = 0;
  let totalVisits = 0;
  const revs = [];
  const lifespans = [];
  const rows = [];
  for (const [id, vs] of groups) {
    if (fromTs != null && !vs.some((v) => v.at >= fromTs && v.at <= toTs)) continue; // only groups active in the range
    const revenue = round2(vs.reduce((a, v) => a + num(v.total), 0));
    revs.push(revenue);
    totalRev += revenue;
    totalVisits += vs.length;
    lifespans.push((vs[vs.length - 1].at - vs[0].at) / DAY);
    rows.push({ id, revenue, visits: vs.length, firstAt: vs[0].at, lastAt: vs[vs.length - 1].at });
  }
  const n = revs.length;
  revs.sort((a, b) => a - b);
  const median = n ? (n % 2 ? revs[(n - 1) / 2] : (revs[n / 2 - 1] + revs[n / 2]) / 2) : 0;
  rows.sort((a, b) => b.revenue - a.revenue);
  return {
    count: n,
    avg: n ? round2(totalRev / n) : 0,
    median: round2(median),
    avgVisits: n ? round2(totalVisits / n) : 0,
    avgLifespanDays: n ? Math.round(mean(lifespans)) : 0,
    total: round2(totalRev),
    rows,
  };
}

/* Average spend per group (customer or car) within [fromTs, toTs] only — the
   money taken in during the selected window, divided by how many distinct
   customers/cars came in. Updates with the date range (unlike lifetime value).
   Pure. */
export function periodSpend(visits, key, fromTs, toTs) {
  const groups = new Set();
  let revenue = 0;
  for (const v of visits || []) {
    if (!(v.at >= fromTs && v.at <= toTs)) continue;
    const id = v && v[key];
    if (id == null || id === "") continue;
    groups.add(id);
    revenue += num(v.total);
  }
  const n = groups.size;
  return { groups: n, revenue: round2(revenue), perGroup: n ? round2(revenue / n) : 0 };
}

/* Lifetime value per customer. rows carry customerId. */
export function customerLtv(visits, fromTs = null, toTs = null) {
  const r = ltvBy(visits, "customerId", fromTs, toTs);
  return {
    customers: r.count,
    ltv: r.avg,
    medianLtv: r.median,
    avgVisits: r.avgVisits,
    avgLifespanDays: r.avgLifespanDays,
    totalRevenue: r.total,
    rows: r.rows.map((x) => ({ customerId: x.id, revenue: x.revenue, visits: x.visits, firstAt: x.firstAt, lastAt: x.lastAt })),
  };
}

/* Lifetime value per vehicle (per car). rows carry vehicleId. */
export function vehicleLtv(visits, fromTs = null, toTs = null) {
  const r = ltvBy(visits, "vehicleId", fromTs, toTs);
  return {
    vehicles: r.count,
    ltv: r.avg,
    medianLtv: r.median,
    avgVisits: r.avgVisits,
    avgLifespanDays: r.avgLifespanDays,
    totalRevenue: r.total,
    rows: r.rows.map((x) => ({ vehicleId: x.id, revenue: x.revenue, visits: x.visits, firstAt: x.firstAt, lastAt: x.lastAt })),
  };
}
