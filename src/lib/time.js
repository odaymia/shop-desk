/* Date and duration helpers. No pay rules live here. */

export const pad2 = (n) => String(n).padStart(2, "0");
export const ym = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
export const dayKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

export function fmtTime(d) {
  if (!d) return "—";
  let h = d.getHours();
  const m = pad2(d.getMinutes());
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}
export function fmtTimeInput(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
export function fmtDateLong(d) {
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}
export function fmtDateShort(d) {
  return d.toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });
}
export function hoursText(ms) {
  if (!ms || ms < 0) ms = 0;
  const total = Math.round(ms / 60000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h ${pad2(m)}m`;
}
export function decHours(ms) {
  if (!ms || ms < 0) return 0;
  return Math.round((ms / 3600000) * 100) / 100;
}
export function startOfWeek(d, weekStart) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = (x.getDay() - weekStart + 7) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}
export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
export function roundTs(ts, mins) {
  if (!mins) return ts;
  const step = mins * 60000;
  return Math.round(ts / step) * step;
}
