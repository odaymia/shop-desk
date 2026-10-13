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

/* a line that is specifically a tire rotation */
export const isRotationLine = (l) => !!l && ["labor", "part", "sublet", "fee"].includes(l.kind) && /rotat/i.test(`${l.job || ""} ${l.description || ""}`);
export const isRotationOrder = (o) => !!o && (o.lines || []).some(isRotationLine);

/* Every invoiced rotation for one car, oldest first: { at, mileage, number }. */
export function rotationsForVehicle(orders, vehicleId) {
  const out = [];
  for (const o of Object.values(orders || {})) {
    if (!o || o.status !== "invoiced" || o.mergedInto || o.vehicleId !== vehicleId) continue;
    if (!isRotationOrder(o)) continue;
    out.push({ at: o.invoicedAt || o.createdAt || 0, mileage: num(o.mileageOut) || num(o.mileageIn) || 0, number: o.number });
  }
  return out.sort((a, b) => a.at - b.at);
}

/* A car's rotation record for the builder: how many done, the cadence, when
   the next one is due (by miles or months), and whether it's on track —
   staying current is what keeps a road-hazard warranty valid. */
export function rotationCompliance({ orders, vehicleId, cfg, now = Date.now(), currentMileage = 0 }) {
  const months = num(cfg && cfg.tireRotationMonths) || 6;
  const miles = num(cfg && cfg.tireRotationMiles) || 5000;
  const cur = num(currentMileage);
  const history = rotationsForVehicle(orders, vehicleId);
  const count = history.length;
  const last = count ? history[count - 1] : null;
  const lastAt = last ? last.at : 0;
  const lastMileage = last ? last.mileage : 0;

  let avgDays = 0, avgMiles = 0;
  if (count >= 2) {
    const first = history[0];
    avgDays = Math.round((last.at - first.at) / DAY / (count - 1)) || 0;
    if (last.mileage && first.mileage) avgMiles = Math.round((last.mileage - first.mileage) / (count - 1)) || 0;
  }

  const nextDueAt = lastAt ? lastAt + months * MONTH : 0;
  const nextDueMileage = lastMileage ? lastMileage + miles : 0;
  const daysSince = lastAt ? Math.round((now - lastAt) / DAY) : null;
  const milesSince = lastMileage && cur ? Math.max(0, cur - lastMileage) : null;
  const dueByDays = nextDueAt ? Math.round((nextDueAt - now) / DAY) : null; // <0 = overdue
  const dueByMiles = nextDueMileage && cur ? nextDueMileage - cur : null; // <0 = overdue
  const overTime = lastAt ? now > nextDueAt : false;
  const overMiles = nextDueMileage && cur ? cur > nextDueMileage : false;

  let status;
  if (!count) status = "none"; // never rotated here
  else if (overTime || overMiles) status = "overdue";
  else if ((dueByDays !== null && dueByDays <= 30) || (dueByMiles !== null && dueByMiles <= 500)) status = "soon";
  else status = "ok";

  return { count, history, lastAt, lastMileage, avgDays, avgMiles, nextDueAt, nextDueMileage, daysSince, milesSince, dueByDays, dueByMiles, status, intervalMonths: months, intervalMiles: miles };
}

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
