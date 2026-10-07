/* Tire reminders — the tire shop's version of "due back". For every car that
   has had tire work, find its last tire service (a tire sale, a rotation, or
   any tire work) and, using the rotation interval, work out when it's due for
   its next rotation. Past due but seen recently → win back; quiet a long time →
   lapsed. Pure and tested. */
import { isFleet } from "./fleet.js";

const DAY = 86400000;
const MONTH = 30.44 * DAY;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/* a line that is tire work: a sold tire (has a size), a rotation, mount/
   balance, flat repair, TPMS, valve stems, wheel work */
const TIRE_WORK = /rotat|balanc|mount|dismount|\btires?\b|tpms|valve stem|flat (repair|fix)|patch|plug|wheel (weight|lock)|lug/i;
export function isTireServiceLine(l) {
  if (!l || !["labor", "part", "sublet", "fee"].includes(l.kind)) return false;
  if (l.kind === "part" && l.tireSize) return true; // a sold tire
  return TIRE_WORK.test(`${l.job || ""} ${l.description || ""}`);
}
export const isTireServiceOrder = (o) => !!o && (o.lines || []).some(isTireServiceLine);

export function tireRotationsDue({ orders, vehicles, customers, cfg, now = Date.now(), lapseDays = 540 }) {
  const months = num(cfg && cfg.tireRotationMonths) || 6;
  const miles = num(cfg && cfg.tireRotationMiles) || 5000;

  /* each car's most recent tire service */
  const lastByVeh = new Map();
  for (const o of Object.values(orders || {})) {
    if (!o || o.status !== "invoiced" || o.mergedInto || !o.invoicedAt || !o.vehicleId) continue;
    if (!isTireServiceOrder(o)) continue;
    const prev = lastByVeh.get(o.vehicleId);
    if (!prev || o.invoicedAt > prev.at) lastByVeh.set(o.vehicleId, { at: o.invoicedAt, mileage: num(o.mileageOut) || num(o.mileageIn) || 0 });
  }

  const rows = [];
  for (const [vid, last] of lastByVeh) {
    const v = vehicles && vehicles[vid];
    if (!v || v.active === false) continue;
    const c = customers && customers[v.customerId];
    if (isFleet(c)) continue; // fleet is managed on its own account
    const nextDueAt = last.at + months * MONTH;
    const dueDays = Math.round((now - nextDueAt) / DAY); // >0 means overdue
    const sinceDays = Math.round((now - last.at) / DAY);
    let status;
    if (dueDays <= 0 && dueDays >= -30) status = "soon";
    else if (dueDays > 0 && sinceDays <= lapseDays) status = "overdue";
    else if (dueDays > 0) status = "lapsed";
    else status = "ok";
    rows.push({
      vehicleId: vid,
      customerId: v.customerId,
      lastAt: last.at,
      lastMileage: last.mileage,
      nextDueAt,
      nextDueMileage: last.mileage ? last.mileage + miles : 0,
      dueDays,
      sinceDays,
      status,
    });
  }
  rows.sort((a, b) => b.dueDays - a.dueDays); // most overdue first
  const by = (s) => rows.filter((r) => r.status === s);
  return { rows, overdue: by("overdue"), soon: by("soon"), lapsed: by("lapsed") };
}
