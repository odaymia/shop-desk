/* Service review — the "what's due" screen for an oil-change visit.

   For each maintenance service, we know a recommended interval (miles + months).
   We look back through the car's own service history to find when it was last
   done, compare against the current mileage and date, and mark it Done, Due
   soon, or Due now. The due items become upsell lines on the estimate.

   The interval table below is a sensible generic schedule, editable in Settings
   and — later — overridable per vehicle by MOTOR's factory schedule. Pure and
   tested (tests/serviceReview.test.js). */
import { matchesAuto } from "./checklist.js";

const MONTH_MS = 30.44 * 24 * 3600 * 1000;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/* id, name, interval (miles, months), `match` words to spot it in past tickets
   (same "a | b -c" grammar as the checklist), and a menu price for the upsell. */
export const DEFAULT_SERVICE_INTERVALS = [
  { id: "oil", name: "Engine oil & filter", miles: 5000, months: 6, match: "oil change | engine oil | oil & filter | oil and filter", price: 0 },
  { id: "tireRotate", name: "Tire rotation", miles: 5000, months: 6, match: "tire rotation | rotate tires", price: 25 },
  { id: "engineAir", name: "Engine air filter", miles: 30000, months: 36, match: "engine air filter | air filter -cabin", price: 45 },
  { id: "cabinAir", name: "Cabin air filter", miles: 30000, months: 24, match: "cabin air filter | cabin filter", price: 55 },
  { id: "brakeFluid", name: "Brake fluid service", miles: 30000, months: 24, match: "brake fluid | brake flush", price: 110 },
  { id: "coolant", name: "Coolant flush", miles: 60000, months: 60, match: "coolant flush | coolant service | antifreeze | radiator flush", price: 130 },
  { id: "trans", name: "Transmission fluid service", miles: 60000, months: 60, match: "transmission fluid | transmission flush | transmission service", price: 180 },
  { id: "diff", name: "Differential fluid service", miles: 45000, months: 48, match: "differential | diff fluid | gear oil", price: 90 },
  { id: "fuelFilter", name: "Fuel filter", miles: 30000, months: 36, match: "fuel filter", price: 60 },
  { id: "sparkPlugs", name: "Spark plugs", miles: 100000, months: 120, match: "spark plug", price: 220 },
  { id: "serpentine", name: "Serpentine belt", miles: 90000, months: 96, match: "serpentine | drive belt", price: 120 },
  { id: "wipers", name: "Wiper blades", miles: 15000, months: 12, match: "wiper", price: 25 },
];

/* Every performed (part/labor/sublet) line description on an order, for matching. */
function orderLineText(o) {
  return (o.lines || [])
    .filter((l) => ["part", "labor", "sublet"].includes(l.kind))
    .map((l) => `${l.job || ""} ${l.description || ""}`)
    .filter((t) => t.trim());
}
const orderMileage = (o) => num(o.mileageOut) || num(o.mileageIn) || 0;
const orderWhen = (o) => o.invoicedAt || o.createdAt || 0;

/* For each service, the most recent past order (excluding `exceptId`) that shows
   it was performed → { at, mileage }. Only invoiced/posted history counts. */
export function lastDoneMap(orders, intervals, exceptId) {
  const done = {};
  const history = Object.values(orders || {})
    .filter((o) => o && o.id !== exceptId && o.status === "invoiced")
    .sort((a, b) => orderWhen(b) - orderWhen(a)); // newest first
  for (const svc of intervals) {
    for (const o of history) {
      if (orderLineText(o).some((t) => matchesAuto(svc.match, t))) {
        done[svc.id] = { at: orderWhen(o), mileage: orderMileage(o) };
        break; // newest match wins
      }
    }
  }
  return done;
}

/* Status of one service given when it was last done, the current mileage, and
   now. "due" = past the interval or never done on a car old enough to need it;
   "soon" = within 80% of the interval; "done" = recently serviced; "unknown" =
   no history and not enough info. */
export function serviceStatus(svc, last, currentMileage, now = Date.now()) {
  const miles = num(svc.miles);
  const months = num(svc.months);
  if (!last) {
    return currentMileage && miles && currentMileage >= miles ? "due" : "unknown";
  }
  const milesSince = currentMileage && last.mileage ? currentMileage - last.mileage : null;
  const monthsSince = last.at ? (now - last.at) / MONTH_MS : null;
  const overMiles = milesSince != null && miles ? milesSince >= miles : false;
  const overMonths = monthsSince != null && months ? monthsSince >= months : false;
  if (overMiles || overMonths) return "due";
  const frac = Math.max(milesSince != null && miles ? milesSince / miles : 0, monthsSince != null && months ? monthsSince / months : 0);
  return frac >= 0.8 ? "soon" : "done";
}

/* The full review: one row per service with its interval, last-done, status, and
   next-due mileage — ordered due first, then soon, then the rest. */
export function serviceReview(intervals, orders, currentMileage, exceptId, now = Date.now()) {
  const last = lastDoneMap(orders, intervals, exceptId);
  const order = { due: 0, soon: 1, unknown: 2, done: 3 };
  const rows = (intervals || []).map((svc) => {
    const l = last[svc.id] || null;
    const status = serviceStatus(svc, l, currentMileage, now);
    const nextDueMiles = l && l.mileage && svc.miles ? l.mileage + num(svc.miles) : svc.miles ? (Math.floor(num(currentMileage) / num(svc.miles)) + 1) * num(svc.miles) : 0;
    return {
      id: svc.id,
      name: svc.name,
      miles: num(svc.miles),
      months: num(svc.months),
      price: num(svc.price),
      match: svc.match,
      lastDone: l,
      status,
      nextDueMiles,
    };
  });
  rows.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.name.localeCompare(b.name));
  return rows;
}

export function reviewCounts(rows) {
  const c = { due: 0, soon: 0, done: 0, unknown: 0 };
  for (const r of rows || []) if (c[r.status] != null) c[r.status] += 1;
  return c;
}
