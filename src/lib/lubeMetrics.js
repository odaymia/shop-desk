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

  const hr = new Array(24).fill(0);
  /* also keep an hour breakdown per weekday, so the screen can show one day's
     hourly pattern (Saturday mornings, say) when a day is clicked */
  const hoursByDay = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const v of inRange) {
    const d = new Date(v.at);
    hr[d.getHours()] += 1;
    hoursByDay[d.getDay()][d.getHours()] += 1;
  }
  const hrPeak = Math.max(...hr);
  const hours = hr.map((count, hour) => ({ hour, count, share: hrPeak ? Math.round((count / hrPeak) * 100) : 0 }));
  /* imported history has no time of day (every visit at midnight); only trust
     the hourly split once visits land in more than one hour */
  const hasHourData = hr.filter((c) => c > 0).length > 1;
  const peakHour = tickets && hasHourData ? hr.indexOf(hrPeak) : null;

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

  return { tickets, cars, revenue, openDays, perDay, busiestDay, weekdays, hours, hoursByDay, peakHour, hasHourData, months };
}
