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
