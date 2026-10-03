/* "Due back" — the win-back list, the most valuable report a quick lube has.
   For every car, find its last oil change and, using the shop's reminder
   interval (or the one saved on that car), work out when it's due again. Cars
   past due but seen recently are win-back targets; ones not seen in a long time
   are lapsed. Pure and tested. */
import { isFleet } from "./fleet.js";
import { isOilChangeOrder } from "./customerAnalytics.js";

const DAY = 86400000;
const MONTH = 30.44 * DAY;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function dueBack({ orders, vehicles, customers, parts, cfg, now = Date.now(), lapseDays = 450 }) {
  const months = num(cfg && cfg.reminderMonths) || 3;
  const miles = num(cfg && cfg.reminderMiles) || 3000;

  /* each car's most recent oil change */
  const lastByVeh = new Map();
  for (const o of Object.values(orders || {})) {
    if (!o || o.status !== "invoiced" || !o.invoicedAt || !o.vehicleId) continue;
    if (!isOilChangeOrder(o, parts)) continue;
    const prev = lastByVeh.get(o.vehicleId);
    if (!prev || o.invoicedAt > prev.at) lastByVeh.set(o.vehicleId, { at: o.invoicedAt, mileage: num(o.mileageOut) || num(o.mileageIn) || 0 });
  }

  const rows = [];
  for (const [vid, last] of lastByVeh) {
    const v = vehicles && vehicles[vid];
    if (!v || v.active === false) continue;
    const c = customers && customers[v.customerId];
    if (isFleet(c)) continue; // fleet is managed on its own account
    const vMonths = num(v.reminderMonths) || months;
    const vMiles = num(v.reminderMiles) || miles;
    const nextDueAt = last.at + vMonths * MONTH;
    const dueDays = Math.round((now - nextDueAt) / DAY); // >0 means overdue
    const sinceDays = Math.round((now - last.at) / DAY);
    let status;
    if (dueDays <= 0 && dueDays >= -30) status = "soon"; // due within the next 30 days
    else if (dueDays > 0 && sinceDays <= lapseDays) status = "overdue"; // past due, still winnable
    else if (dueDays > 0) status = "lapsed"; // gone quiet for a long time
    else status = "ok"; // not due for a while yet
    rows.push({
      vehicleId: vid,
      customerId: v.customerId,
      lastAt: last.at,
      lastMileage: last.mileage,
      nextDueAt,
      nextDueMileage: last.mileage ? last.mileage + vMiles : 0,
      dueDays,
      sinceDays,
      status,
    });
  }
  rows.sort((a, b) => b.dueDays - a.dueDays); // most overdue first
  const by = (s) => rows.filter((r) => r.status === s);
  return { rows, overdue: by("overdue"), soon: by("soon"), lapsed: by("lapsed") };
}
