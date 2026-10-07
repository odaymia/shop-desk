/* Tire warranties — road hazard and tread-life (mileage) — tracked from the
   sale and redeemed as a prorated credit on the replacement. Warranties are
   DERIVED from invoiced orders, never stored on their own, so they can't drift
   from what was actually sold: a sale is a record when it has tire lines, and a
   road-hazard line (stamped `warranty: "hazard"` by the tire quote) means the
   tires on that ticket are covered. A claim is just a credit line on the new
   sale that points back to the original ticket. Pure — no React, no storage. */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const DAY = 86400000;

/* default coverage terms; a shop overrides them under Settings → warranties */
export const DEFAULT_WARRANTY = {
  roadHazardMonths: 36, // road hazard runs this long from the sale
  roadHazardBasis: "tread", // prorate a claim by remaining "tread" or by "time"
  newTread32: 10, // tread depth of a new passenger tire, in 32nds (for the tread basis)
};
export const warrantyTerms = (cfg) => ({ ...DEFAULT_WARRANTY, ...((cfg && cfg.warranty) || {}) });

/* a sold tire on a ticket: a part line carrying a tire size */
export const isTireLine = (l) => !!l && l.kind === "part" && !!l.tireSize;
/* was road hazard sold on this ticket? */
export const hasRoadHazard = (order) => !!order && (order.lines || []).some((l) => l && l.warranty === "hazard");

/* add whole months to a timestamp, keeping the day of month where possible */
function addMonths(ts, months) {
  const d = new Date(ts);
  const day = d.getDate();
  d.setMonth(d.getMonth() + Math.round(num(months)));
  if (d.getDate() < day) d.setDate(0); // clamp Mar 31 + 1mo → Apr 30
  return d.getTime();
}

/* One warranty record per invoiced ticket that sold tires, newest first.
   Fleet sales are included — fleets buy tires too — the UI can filter. */
export function tireWarranties({ orders }) {
  const out = [];
  for (const o of Object.values(orders || {})) {
    if (!o || o.status !== "invoiced" || o.mergedInto) continue;
    const tireLines = (o.lines || []).filter(isTireLine);
    if (!tireLines.length) continue;
    const tires = tireLines.map((l) => ({
      lineId: l.id,
      description: String(l.description || "Tire").trim(),
      size: l.tireSize || "",
      qty: Math.max(1, Math.round(num(l.qty)) || 1),
      price: round2(num(l.price)),
      treadlifeMiles: Math.round(num(l.treadlifeMiles)) || 0,
      dots: Array.isArray(l.dots) ? l.dots.slice() : [],
    }));
    out.push({
      orderId: o.id,
      number: o.number,
      at: o.invoicedAt || o.createdAt || 0,
      customerId: o.customerId || null,
      vehicleId: o.vehicleId || null,
      mileage: Math.round(num(o.mileageOut) || num(o.mileageIn)) || 0,
      roadHazard: hasRoadHazard(o),
      tires,
      tireCount: tires.reduce((a, t) => a + t.qty, 0),
    });
  }
  return out.sort((a, b) => (b.at || 0) - (a.at || 0));
}

/* Coverage of one record as of `now`. Road hazard is time-bound; tread-life is
   per tire and depends on miles driven, so it's only flagged as available. */
export function warrantyStatus(record, cfg, now = Date.now()) {
  const t = warrantyTerms(cfg);
  const expiresAt = addMonths(record.at, t.roadHazardMonths);
  const roadHazard = record.roadHazard
    ? { sold: true, expiresAt, active: now <= expiresAt, daysLeft: Math.ceil((expiresAt - now) / DAY) }
    : { sold: false, active: false };
  const treadlife = (record.tires || []).some((tire) => tire.treadlifeMiles > 0);
  return { roadHazard, treadlife };
}

/* Prorated road-hazard credit for one damaged tire. By "tread": the customer
   gets back the value of the tread still left (remaining ÷ new). By "time":
   the share of the coverage window still remaining. Expired → nothing. */
export function roadHazardCredit({ tirePrice, soldAt, now = Date.now(), cfg, newTread32, remainingTread32 }) {
  const t = warrantyTerms(cfg);
  const price = round2(num(tirePrice));
  if (price <= 0) return 0;
  const expiresAt = addMonths(soldAt, t.roadHazardMonths);
  if (now >= expiresAt) return 0;
  if (t.roadHazardBasis === "time") {
    const frac = (expiresAt - now) / (expiresAt - soldAt || 1);
    return clamp(round2(price * frac), 0, price);
  }
  const nw = num(newTread32) || t.newTread32 || 10;
  const rem = clamp(num(remainingTread32), 0, nw);
  return clamp(round2(price * (rem / (nw || 1))), 0, price);
}

/* Tread-life (mileage) adjustment credit: the share of rated miles not yet
   driven, applied to the price of the replacement. */
export function treadlifeCredit({ tirePrice, warrantyMiles, milesUsed }) {
  const price = round2(num(tirePrice));
  const miles = num(warrantyMiles);
  if (price <= 0 || miles <= 0) return 0;
  const used = clamp(num(milesUsed), 0, miles);
  return clamp(round2(price * (1 - used / miles)), 0, price);
}

/* A plain-language description for the credit line a claim adds to the new
   ticket, so the invoice shows what was honored. */
export function claimLineLabel({ kind, fromNumber, size }) {
  const what = kind === "treadlife" ? "Tread-life adjustment" : "Road hazard warranty";
  return `${what} credit — ${size || "tire"} from invoice #${fromNumber}`;
}
