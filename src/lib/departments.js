/* The shop's departments: oil & lube, tires, and mechanical. Each is its own
   page with its own ticket list, but a ticket is still one ticket: when a
   car gets an oil change and two tires, both departments see the same
   ticket and the customer gets one receipt.

   A ticket's departments come from its work (the service code of each
   line), plus the department it was started in. Pure: no React, no storage. */
import { lineCode } from "./serviceCodes.js";
import { lineAmount, round2 } from "./invoice.js";

export const DEPTS = [
  { id: "oil", label: "Oil & lube", noun: "oil change", icon: "🛢️" },
  { id: "tires", label: "Tires", noun: "tire ticket", icon: "🛞" },
  { id: "mech", label: "Mechanical", noun: "repair", icon: "🔧" },
];
export const deptLabel = (id) => (DEPTS.find((d) => d.id === id) || {}).label || "";

/* Which departments the shop runs (Settings → Tickets). All three unless
   turned off; a tire-only shop turns off the other two. */
export function activeDepts(cfg) {
  const on = (cfg && cfg.departments) || {};
  return DEPTS.filter((d) => on[d.id] !== false);
}

/* Quick-lube menu work: the oil change and the fluids, filters, wipers and
   bulbs that go with it. */
const OIL_CODES = new Set(["OIL", "CAF", "AF", "ATF", "RAD", "BF", "PS", "DIFF", "TC", "FUEL", "WIPER", "BULB"]);
const TIRE_CODES = new Set(["TIRE", "ALIGN"]);

/* Shorthand the service codes don't catch, seen on real quick-lube tickets
   ("2PT FUEL INJECT SERVICE", "VPS PWR STEERING SERVICE", "TPMS SENSOR"),
   and charges that aren't work even when rung up as a part. */
const text = (l) => `${l.job || ""} ${l.description || ""}`.toLowerCase();
const OIL_TEXT = /fuel (inj|sys)|injector|induction|\b[23] ?(pt|part)\b|two.?part|three.?part|pwr steer|power steer|oil (additive|treatment|stabilizer)|fuel (additive|treatment)|max.?life/;
const TIRE_TEXT = /tpms|valve stem|flat (repair|fix)|tire (patch|plug|repair)|lug nut|wheel lock/;
const NOT_WORK = /disposal|hazard|environmental|shop suppl|recycl|core charge|core deposit/;
const isWork = (l) => !!l && ["labor", "part", "sublet"].includes(l.kind) && !NOT_WORK.test(text(l));

/* The department one line belongs to, or null for lines that aren't work
   (notes, fees, discounts). Anything that isn't lube or tires is mechanical. */
export function lineDept(line, parts) {
  if (!isWork(line)) return null;
  if (TIRE_TEXT.test(text(line))) return "tires";
  if (OIL_TEXT.test(text(line))) return "oil";
  const c = lineCode(line, parts);
  if (c && OIL_CODES.has(c)) return "oil";
  if (c && TIRE_CODES.has(c)) return "tires";
  return "mech";
}

/* Every department a ticket touches, in menu order. A ticket with no work
   yet belongs to the department it was started in (mechanical when it
   wasn't started in one). */
/* Tickets are replaced, never edited in place, so each one's answer is
   remembered: a department page sifts tens of thousands of tickets. */
const memo = new WeakMap();
export function orderDepts(order, parts) {
  if (order && typeof order === "object") {
    const hit = memo.get(order);
    if (hit && hit.parts === parts) return hit.depts;
    const depts = computeDepts(order, parts);
    memo.set(order, { parts, depts });
    return depts;
  }
  return computeDepts(order, parts);
}
function computeDepts(order, parts) {
  const found = new Set();
  if (order && order.dept) found.add(order.dept);
  for (const l of (order && order.lines) || []) {
    const d = lineDept(l, parts);
    if (d) found.add(d);
  }
  if (!found.size) found.add("mech");
  return DEPTS.map((d) => d.id).filter((id) => found.has(id));
}
export const inDept = (order, dept, parts) => orderDepts(order, parts).includes(dept);

/* One department's share of a ticket's work, before tax: its own lines. */
export function deptAmount(order, dept, parts) {
  let n = 0;
  for (const l of (order && order.lines) || []) if (lineDept(l, parts) === dept) n += lineAmount(l);
  return round2(n);
}

/* ---------- preventative maintenance ---------- */

/* California B&P §9884.9(e): no written estimate is needed for the
   preventative maintenance services listed in §9880.1(j) when the price is
   posted (or shown and acknowledged) and the customer authorizes it. The
   codes below are that list as our service codes read it; brakes, brake
   fluid, batteries, diagnosis, and anything we can't classify are not. */
const PM_CODES = new Set(["OIL", "CAF", "AF", "ATF", "RAD", "PS", "DIFF", "TC", "FUEL", "WIPER", "BULB"]);
const PM_TIRE = /rotat|tire pressure|air pressure|\bpressure\b/i;

export function isMaintenanceLine(line, parts) {
  if (!isWork(line)) return true; // notes, fees, discounts don't change it
  if (OIL_TEXT.test(text(line))) return true;
  const c = lineCode(line, parts);
  if (c && PM_CODES.has(c)) return true;
  if (c === "TIRE" && PM_TIRE.test(`${line.job || ""} ${line.description || ""}`)) return true;
  return false;
}
/* Every line on the ticket is preventative maintenance (and there is work). */
export function isMaintenanceOnly(order, parts) {
  const lines = ((order && order.lines) || []).filter(isWork);
  return lines.length > 0 && lines.every((l) => isMaintenanceLine(l, parts));
}
/* Does this ticket need the customer's signed or recorded authorization?
   Everything does, except maintenance-only work when the shop has chosen
   not to require it (cfg.pmSignature === "optional", the default). */
export function authorizationRequired(order, cfg, parts) {
  if ((cfg && cfg.pmSignature) === "required") return true;
  return !isMaintenanceOnly(order, parts);
}

/* ---------- combining tickets ---------- */

/* Other open tickets (estimate or repair order) for the same car that
   could go on this ticket's receipt. */
export function combinable(order, orders) {
  if (!order || !order.vehicleId || !["estimate", "open"].includes(order.status)) return [];
  return Object.values(orders || {}).filter(
    (o) => o && o.id !== order.id && o.vehicleId === order.vehicleId && ["estimate", "open"].includes(o.status) && !o.mergedInto
  );
}

/* Move `from`'s work onto `into` so the customer gets one receipt. Lines,
   payments, recommendations and findings come over; the concern, notes,
   and the higher mileage are kept; the crew fills in any blanks. `from`
   is marked deleted with a pointer to the ticket it went into (its number
   isn't reused). → { into, from } to save. */
export function mergeTickets(into, from, at = Date.now()) {
  const join = (a, b) => [a, b].map((s) => String(s || "").trim()).filter(Boolean).filter((s, i, xs) => xs.indexOf(s) === i).join("\n");
  const miles = (v) => Number(String(v == null ? "" : v).replace(/[^\d.]/g, "")) || 0;
  const higher = (a, b) => (miles(b) > miles(a) ? b : a);
  const crew = ["writerId", "advisorId", "techId", "topTechId", "pitTechId"];
  const next = {
    ...into,
    lines: [...(into.lines || []), ...(from.lines || [])],
    payments: [...(into.payments || []), ...(from.payments || [])],
    recommendations: [...(into.recommendations || []), ...(from.recommendations || [])],
    concern: join(into.concern, from.concern),
    notes: join(into.notes, from.notes),
    mileageIn: higher(into.mileageIn, from.mileageIn),
    mileageOut: higher(into.mileageOut, from.mileageOut),
    mergedFrom: [...(into.mergedFrom || []), from.number],
    history: [...(into.history || []), { at, what: `combined with #${from.number}` }],
  };
  for (const k of crew) if (!next[k] && from[k]) next[k] = from[k];
  if (!next.checklist && from.checklist) next.checklist = from.checklist;
  if (!next.dept && from.dept) next.dept = from.dept;
  if (!next.customerId && from.customerId) next.customerId = from.customerId;
  const gone = {
    ...from,
    status: "deleted",
    mergedInto: into.id,
    lines: [],
    payments: [],
    history: [...(from.history || []), { at, what: `combined into #${into.number}` }],
  };
  return { into: next, from: gone };
}
