/* Shop-throughput analytics for a quick lube: how many cars come through, how
   busy each day is, and a month-by-month breakdown. Works on the same "visits"
   list the Analytics screen builds. Pure and tested. */
import { round2 } from "./invoice.js";

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayStr = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const monthStr = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export function throughput(visits, fromTs, toTs) {
  const inRange = (visits || []).filter((v) => v && v.at >= fromTs && v.at <= toTs);
  const tickets = inRange.length;
  const cars = new Set(inRange.map((v) => v.vehicleId).filter(Boolean)).size;
  const revenue = round2(inRange.reduce((a, v) => a + num(v.total), 0));

  const openDays = new Set(inRange.map((v) => dayStr(v.at))).size;
  const perDay = openDays ? round2(tickets / openDays) : 0;

  const wd = [0, 0, 0, 0, 0, 0, 0];
  for (const v of inRange) wd[new Date(v.at).getDay()] += 1;
  const peak = Math.max(...wd);
  const weekdays = wd.map((count, i) => ({ day: WEEKDAYS[i], count, share: peak ? Math.round((count / peak) * 100) : 0 }));
  const busiestDay = tickets ? WEEKDAYS[wd.indexOf(peak)] : "—";

  const m = new Map();
  for (const v of inRange) {
    const key = monthStr(v.at);
    const row = m.get(key) || { month: key, tickets: 0, cars: new Set(), revenue: 0 };
    row.tickets += 1;
    if (v.vehicleId) row.cars.add(v.vehicleId);
    row.revenue += num(v.total);
    m.set(key, row);
  }
  const months = [...m.values()]
    .map((r) => ({ month: r.month, tickets: r.tickets, cars: r.cars.size, revenue: round2(r.revenue), avgTicket: r.tickets ? round2(r.revenue / r.tickets) : 0 }))
    .sort((a, b) => (a.month < b.month ? 1 : -1));

  return { tickets, cars, revenue, openDays, perDay, busiestDay, weekdays, months };
}
