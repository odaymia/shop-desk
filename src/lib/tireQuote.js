/* The tire quote: size → tire → how many → add-ons → the lines that go on
   the estimate. Pure — no React, no storage. The desk's TireQuote screen
   walks the counter through it; this file does the picking and the math. */
import { normalizeTireSize, isTireSize, tireSizeKey, tireName } from "./tires.js";

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* What a shop can put on a tire sale besides the tires. `per` is "tire"
   (multiplies by the count) or "ticket" (once). `on` = ticked by default.
   Shops change prices and add their own under Settings → Departments &
   signatures → Tire quote add-ons. */
export const DEFAULT_TIRE_ADDONS = [
  { id: "mount", label: "Mount, balance & disposal", kind: "labor", per: "tire", price: 25, on: true },
  { id: "catire", label: "CA tire fee", kind: "fee", per: "tire", price: 1.75, on: true, note: "State fee on every new tire sold in California" },
  { id: "stems", label: "New valve stems", kind: "part", per: "tire", price: 4, on: false },
  { id: "hazard", label: "Road hazard warranty", kind: "fee", per: "tire", price: 15, on: false, note: "Covers flats and road damage" },
  { id: "tpms", label: "TPMS sensor", kind: "part", per: "tire", price: 55, on: false },
  { id: "tpmskit", label: "TPMS service kit", kind: "part", per: "tire", price: 8, on: false, note: "New seals and nuts for the existing sensors" },
  { id: "align", label: "4-wheel alignment", kind: "labor", per: "ticket", price: 99.99, on: false },
  { id: "nitrogen", label: "Nitrogen fill", kind: "fee", per: "tire", price: 5, on: false },
];
/* the shop's own list once it has saved one (even an empty one) */
export const tireAddOns = (cfg) => (cfg && Array.isArray(cfg.tireAddOns) ? cfg.tireAddOns : DEFAULT_TIRE_ADDONS);

/* The size to start on: the one saved on the car, else the tire this car
   was last sold. `orders` is the car's own tickets (newest first is not
   required). */
export function sizeForVehicle(vehicle, orders, parts) {
  if (vehicle && isTireSize(normalizeTireSize(vehicle.tireSize))) return { size: normalizeTireSize(vehicle.tireSize), from: "car" };
  const prior = (orders || []).filter((o) => o && o.status !== "deleted").sort((a, b) => (b.invoicedAt || b.createdAt || 0) - (a.invoicedAt || a.createdAt || 0));
  for (const o of prior)
    for (const l of o.lines || []) {
      const p = l.partId && parts && parts[l.partId];
      const s = normalizeTireSize((p && p.tire && p.size) || l.tireSize || "");
      if (isTireSize(s)) return { size: s, from: "history", at: o.invoicedAt || o.createdAt };
    }
  return { size: "", from: "" };
}

/* Inventory tires in one size, cheapest first, in-stock ahead of
   out-of-stock at the same price. */
export function tiresForSize(parts, size) {
  const want = normalizeTireSize(size);
  if (!want) return [];
  return Object.values(parts || {})
    .filter((p) => p && p.tire && p.active !== false && normalizeTireSize(p.size) === want)
    .sort((a, b) => num(a.price) - num(b.price) || (num(b.onHand) > 0) - (num(a.onHand) > 0) || tireName(a).localeCompare(tireName(b)));
}

/* Sizes with tires on the rack, smallest rim first, for quick picking. */
export function stockedSizes(parts) {
  const n = {};
  for (const p of Object.values(parts || {})) {
    if (!p || !p.tire || p.active === false) continue;
    const s = normalizeTireSize(p.size);
    if (isTireSize(s)) n[s] = (n[s] || 0) + Math.max(0, num(p.onHand));
  }
  return Object.entries(n)
    .map(([size, onHand]) => ({ size, onHand }))
    .sort((a, b) => {
      const x = tireSizeKey(a.size), y = tireSizeKey(b.size);
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    });
}

/* The estimate lines for a quote. `tire` is an inventory part, or a typed
   one ({ description, price }) for a tire ordered in; `picked` is the
   add-ons chosen with their (possibly edited) prices; `id` makes line ids.
   Everything shares one job name so it prints and removes as a group. */
export function tireQuoteLines({ tire, size, count, picked, cfg, id }) {
  const n = Math.max(1, Math.round(num(count)) || 1);
  const sz = normalizeTireSize(size || (tire && tire.size));
  /* an inventory tire reads as brand + model; a typed one as typed */
  const name = !tire ? "Tire" : tire.tire ? tireName(tire) : String(tire.description || "Tire").trim();
  const job = `Tires: ${name} ${sz} × ${n}`.replace(/\s+/g, " ").trim();
  const lines = [];
  if (tire) {
    lines.push({
      id: id(),
      kind: "part",
      job,
      partId: tire.id && tire.tire ? tire.id : null,
      number: tire.number || "",
      description: `${name} ${sz}${tire.loadSpeed ? ` ${tire.loadSpeed}` : ""}`.trim(),
      tireSize: sz,
      qty: n,
      price: round2(num(tire.price)),
      cost: round2(num(tire.cost)),
      condition: "new",
      taxable: null,
    });
  }
  for (const a of picked || []) {
    const qty = a.per === "ticket" ? 1 : n;
    const price = round2(num(a.price));
    const base = { id: id(), job, description: a.label, taxable: a.taxable === true || a.taxable === false ? a.taxable : null };
    if (a.kind === "labor") lines.push({ ...base, kind: "labor", details: "", hours: qty, rate: price, unit: a.per === "ticket" ? "service" : "tire", techId: null });
    else if (a.kind === "part") lines.push({ ...base, kind: "part", partId: a.partId || null, number: a.number || "", qty, price, cost: round2(num(a.cost)), condition: "new" });
    else lines.push({ ...base, kind: "fee", qty, price });
  }
  return { job, lines };
}

/* Quick math for the screen before anything is on the ticket. */
export function quoteSubtotal(lines) {
  return round2(
    (lines || []).reduce((s, l) => s + (l.kind === "labor" ? num(l.hours) * num(l.rate) : num(l.qty) * num(l.price)), 0)
  );
}
