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
// `match` = words to spot the service in past tickets (checklist grammar).
// `motorKeys` = words in MOTOR's schedule names, to pull the real factory interval.
// `basis` = "interval" (due by miles/months) or "inspect" (checked each visit,
//   replaced when needed — air filters, wipers). `requiresFluid` = a fluid the
//   vehicle must have, else the service is hidden (power steering on electric
//   steering, differential on FWD) when MOTOR data says so.
export const DEFAULT_SERVICE_INTERVALS = [
  { id: "oil", name: "Engine oil & filter", basis: "interval", miles: 5000, months: 6, match: "oil change | engine oil | oil & filter | oil and filter", motorKeys: ["engine oil"], price: 0 },
  { id: "tireRotate", name: "Tire rotation", basis: "interval", miles: 5000, months: 6, match: "tire rotation | rotate tires", motorKeys: ["tire rotation", "rotate tire"], price: 25 },
  { id: "engineAir", name: "Engine air filter", basis: "inspect", miles: 30000, months: 36, match: "engine air filter | air filter -cabin", motorKeys: ["engine air filter", "air cleaner"], price: 45 },
  { id: "cabinAir", name: "Cabin air filter", basis: "inspect", miles: 30000, months: 24, match: "cabin air filter | cabin filter", motorKeys: ["cabin air filter", "passenger compartment air filter"], price: 55 },
  { id: "brakeFluid", name: "Brake fluid service", basis: "interval", miles: 30000, months: 24, match: "brake fluid | brake flush", motorKeys: ["brake fluid"], price: 110 },
  { id: "coolant", name: "Coolant flush", basis: "interval", miles: 60000, months: 60, match: "coolant flush | coolant service | antifreeze | radiator flush", motorKeys: ["cooling system", "coolant", "engine coolant"], price: 130 },
  { id: "trans", name: "Transmission fluid service", basis: "interval", miles: 60000, months: 60, match: "transmission fluid | transmission flush | transmission service", motorKeys: ["transmission fluid", "transaxle fluid"], requiresFluid: "transmission", price: 180 },
  { id: "diff", name: "Differential fluid service", basis: "interval", miles: 45000, months: 48, match: "differential | diff fluid | gear oil", motorKeys: ["differential", "axle fluid"], requiresFluid: "differential", price: 90 },
  { id: "psFluid", name: "Power steering fluid service", basis: "interval", miles: 75000, months: 72, match: "power steering fluid | power steering flush", motorKeys: ["power steering"], requiresFluid: "power steering", price: 100 },
  { id: "fuelFilter", name: "Fuel filter", basis: "inspect", miles: 30000, months: 36, match: "fuel filter", motorKeys: ["fuel filter"], requiresFluid: "fuel filter", price: 60 },
  { id: "sparkPlugs", name: "Spark plugs", basis: "interval", miles: 100000, months: 120, match: "spark plug", motorKeys: ["spark plug"], price: 220 },
  { id: "serpentine", name: "Serpentine belt", basis: "inspect", miles: 90000, months: 96, match: "serpentine | drive belt", motorKeys: ["drive belt", "serpentine belt", "accessory drive belt"], price: 120 },
  { id: "wipers", name: "Wiper blades", basis: "inspect", miles: 15000, months: 12, match: "wiper", motorKeys: ["wiper"], price: 25 },
];

/* Drop services for equipment the vehicle doesn't have. `motorNames` is the pool
   of fluid + maintenance names MOTOR returned for this vehicle; a service whose
   `requiresFluid` keyword isn't present is hidden. With no MOTOR data we can't
   tell, so everything stays. Pure. */
export function filterApplicable(intervals, motorNames) {
  const hay = (motorNames || []).join(" | ").toLowerCase();
  if (!hay.trim()) return intervals || [];
  return (intervals || []).filter((svc) => !svc.requiresFluid || hay.includes(String(svc.requiresFluid).toLowerCase()));
}

/* Only the services the owner has turned on (Settings). */
export const activeIntervals = (intervals) => (intervals || []).filter((s) => s && s.enabled !== false);

/* Combine the shop's own intervals with the vehicle's real MOTOR factory schedule.
   `mode` is the owner's choice:
     - "store": use the shop's intervals only (no MOTOR).
     - "motor": use the manufacturer interval where MOTOR has it, else the shop's.
     - "both": same effective interval as "motor", but keep both numbers so the
       screen can show store vs manufacturer side by side.
   Each row carries storeMiles/Months, motorMiles/Months, the effective
   miles/months (used for due/done), and a source tag. Pure. */
export function mergeMotorIntervals(intervals, motorServices, mode = "both") {
  const svcs = (motorServices || []).filter((m) => m && m.name && (num(m.miles) > 0 || num(m.months) > 0));
  const rank = (name) => (/replace|service|flush|exchange|change|drain/i.test(name) ? 2 : /inspect/i.test(name) ? 0 : 1);
  let matched = 0;
  const merged = (intervals || []).map((svc) => {
    const storeMiles = num(svc.miles);
    const storeMonths = num(svc.months);
    const keys = (svc.motorKeys || []).map((k) => k.toLowerCase());
    const cands = mode === "store" ? [] : svcs.filter((m) => keys.some((k) => m.name.toLowerCase().includes(k)));
    cands.sort((a, b) => rank(b.name) - rank(a.name) || num(a.miles) - num(b.miles));
    const m = cands[0] || null;
    const motorMiles = m ? num(m.miles) : 0;
    const motorMonths = m ? num(m.months) : 0;
    const useMotor = mode !== "store" && m && (motorMiles > 0 || motorMonths > 0);
    if (useMotor) matched += 1;
    return {
      ...svc,
      storeMiles,
      storeMonths,
      motorMiles,
      motorMonths,
      motorName: m ? m.name : "",
      miles: useMotor ? motorMiles || storeMiles : storeMiles,
      months: useMotor ? motorMonths || storeMonths : storeMonths,
      source: useMotor ? "MOTOR" : "store",
    };
  });
  return { intervals: merged, source: matched && mode !== "store" ? "MOTOR" : "store", matched, mode };
}

/* Tidy an edited interval table for saving (Settings). */
export function normalizeServiceIntervals(rows) {
  return (rows || [])
    .filter((r) => String(r.name || "").trim())
    .map((r) => ({
      id: r.id || String(r.name).toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || `s${Math.random().toString(36).slice(2, 7)}`,
      name: String(r.name).trim(),
      basis: r.basis === "inspect" ? "inspect" : "interval",
      miles: Math.max(0, Math.round(num(r.miles))),
      months: Math.max(0, Math.round(num(r.months))),
      price: Math.max(0, num(r.price)),
      match: String(r.match || r.name || "").trim(),
      motorKeys: Array.isArray(r.motorKeys) ? r.motorKeys : String(r.motorKeys || r.name || "").split("|").map((s) => s.trim()).filter(Boolean),
      ...(r.requiresFluid ? { requiresFluid: String(r.requiresFluid).trim() } : {}),
      enabled: r.enabled !== false,
    }));
}

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
  if (svc.basis === "inspect") return "inspect"; // checked each visit, replaced if needed
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
  const order = { due: 0, soon: 1, inspect: 2, unknown: 3, done: 4 };
  const rows = (intervals || []).map((svc) => {
    const l = last[svc.id] || null;
    const status = serviceStatus(svc, l, currentMileage, now);
    const nextDueMiles = l && l.mileage && svc.miles ? l.mileage + num(svc.miles) : svc.miles ? (Math.floor(num(currentMileage) / num(svc.miles)) + 1) * num(svc.miles) : 0;
    return {
      ...svc, // carries basis, source, store/motor intervals, price, match…
      miles: num(svc.miles),
      months: num(svc.months),
      price: num(svc.price),
      lastDone: l,
      status,
      nextDueMiles,
    };
  });
  rows.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.name.localeCompare(b.name));
  return rows;
}

export function reviewCounts(rows) {
  const c = { due: 0, soon: 0, done: 0, unknown: 0, inspect: 0 };
  for (const r of rows || []) if (c[r.status] != null) c[r.status] += 1;
  return c;
}
