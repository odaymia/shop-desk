/* Fleet accounts: a customer flagged as a fleet (customer.fleet) gets automatic
   per-category discounts on their tickets and rolls up into a fleet report.
   Pure — no React, no storage. */
import { lineAmount, round2, orderTotals } from "./invoice.js";
import { lineCode } from "./serviceCodes.js";

export const isFleet = (c) => !!(c && c.fleet);
export const fleetName = (c) => (c && (c.company || [c.first, c.last].filter(Boolean).join(" ").trim())) || "Fleet account";
export const DEFAULT_FLEET = { discounts: { oil: 0, tires: 0, mechanical: 0 }, poRequired: false, notes: "" };

const pct = (v) => Math.max(0, Math.min(100, Number(v) || 0));

/* Which discount bucket a charge line falls in: oil change, tires, or general
   mechanical (everything else that's labor/parts/sublet). Non-charges → null. */
export function lineFleetCategory(line, parts) {
  if (!line || !["labor", "part", "sublet"].includes(line.kind)) return null;
  if (line.fleetDiscount) return null;
  const c = lineCode(line, parts);
  if (c === "OIL") return "oil";
  if (c === "TIRE") return "tires";
  return "mechanical";
}

/* The discount owed per bucket for this order at the fleet's percentages. */
export function fleetDiscountAmounts(order, customer, parts) {
  const d = (customer && customer.fleet && customer.fleet.discounts) || {};
  const base = { oil: 0, tires: 0, mechanical: 0 };
  for (const l of (order && order.lines) || []) {
    const cat = lineFleetCategory(l, parts);
    if (cat) base[cat] = round2(base[cat] + lineAmount(l));
  }
  return {
    oil: round2((base.oil * pct(d.oil)) / 100),
    tires: round2((base.tires * pct(d.tires)) / 100),
    mechanical: round2((base.mechanical * pct(d.mechanical)) / 100),
  };
}

/* The single fleet-discount line to keep on the order (a discount line the
   ticket editor syncs), or null when nothing qualifies. */
export function fleetDiscountLine(order, customer, parts) {
  if (!isFleet(customer)) return null;
  const a = fleetDiscountAmounts(order, customer, parts);
  const total = round2(a.oil + a.tires + a.mechanical);
  if (total <= 0.005) return null;
  const d = customer.fleet.discounts || {};
  const bits = [];
  if (a.oil > 0) bits.push(`oil ${pct(d.oil)}%`);
  if (a.tires > 0) bits.push(`tires ${pct(d.tires)}%`);
  if (a.mechanical > 0) bits.push(`labor ${pct(d.mechanical)}%`);
  return { price: total, description: `Fleet discount — ${bits.join(", ")}` };
}

/* Roll-up for the fleet report from the account's invoiced tickets. */
export function fleetStats(orders, customer, cfg, parts) {
  const inv = (orders || []).filter((o) => o && o.status === "invoiced" && o.customerId === (customer && customer.id));
  let lifetime = 0;
  let last = null;
  let onAccount = 0;
  let saved = 0;
  const byCat = { oil: 0, tires: 0, mechanical: 0 };
  for (const o of inv) {
    const t = orderTotals(o, cfg, customer);
    lifetime = round2(lifetime + t.total);
    if ((o.invoicedAt || 0) > (last || 0)) last = o.invoicedAt || null;
    for (const l of o.lines || []) {
      const cat = lineFleetCategory(l, parts);
      if (cat) byCat[cat] = round2(byCat[cat] + lineAmount(l));
      if (l.fleetDiscount) saved = round2(saved + lineAmount(l));
    }
    for (const p of o.payments || []) if (p.method === "account") onAccount = round2(onAccount + (Number(p.amount) || 0));
  }
  return { visits: inv.length, lifetime, last, byCat, onAccount, saved };
}

/* Shop-wide fleet report over [fromTs, toTs]: totals across every fleet
   account, and a per-account row (revenue, tickets and discounts in the range,
   plus the all-time balance still owed on account). Pure. */
export function fleetReport(orders, customers, cfg, parts, fromTs, toTs) {
  const fleets = Object.values(customers || {}).filter(isFleet);
  const all = Object.values(orders || {});
  let revenue = 0;
  let tickets = 0;
  let discounts = 0;
  let onAccount = 0;
  let outstanding = 0;
  let activeAccounts = 0;
  const rows = [];
  for (const c of fleets) {
    const inv = all.filter((o) => o && o.status === "invoiced" && o.customerId === c.id);
    let rev = 0;
    let disc = 0;
    let onAcct = 0;
    let last = null;
    let bal = 0;
    let n = 0;
    for (const o of inv) {
      const at = o.invoicedAt || 0;
      const t = orderTotals(o, cfg, c);
      bal = round2(bal + Math.max(0, t.balance));
      if (at > (last || 0)) last = at || null;
      if (at >= fromTs && at <= toTs) {
        n += 1;
        rev = round2(rev + t.total);
        for (const l of o.lines || []) if (l.fleetDiscount) disc = round2(disc + Math.abs(lineAmount(l)));
      }
      for (const p of o.payments || []) if (p.method === "account" && p.at >= fromTs && p.at <= toTs) onAcct = round2(onAcct + (Number(p.amount) || 0));
    }
    revenue = round2(revenue + rev);
    tickets += n;
    discounts = round2(discounts + disc);
    onAccount = round2(onAccount + onAcct);
    outstanding = round2(outstanding + bal);
    if (n) activeAccounts += 1;
    rows.push({ id: c.id, name: fleetName(c), tickets: n, revenue: rev, discounts: disc, balance: bal, last });
  }
  rows.sort((a, b) => b.revenue - a.revenue);
  return { accounts: fleets.length, activeAccounts, revenue, tickets, discounts, onAccount, outstanding, rows };
}

/* Moving a car the shop already knows onto a fleet account. The car
   changes owner; its past tickets move too only when asked (they then
   count in the account's history and report). A moved invoice keeps the
   tax it was charged: the fleet may be tax exempt, and a finished
   invoice must not change its total. No fleet discount is applied to
   past work. → { vehicle, orders } to save. */
export function moveVehicleToFleet({ vehicle, orders, fleet, fromCustomer, cfg, moveHistory }) {
  const moved = { ...vehicle, customerId: fleet.id };
  if (!moveHistory) return { vehicle: moved, orders: [] };
  const out = (orders || [])
    .filter((o) => o && o.vehicleId === vehicle.id && o.customerId !== fleet.id && o.status !== "deleted")
    .map((o) => {
      const next = { ...o, customerId: fleet.id, movedFrom: o.customerId || "" };
      if (o.status === "invoiced" && o.taxOverride == null) next.taxOverride = orderTotals(o, cfg, fromCustomer).tax;
      return next;
    });
  return { vehicle: moved, orders: out };
}
