/* Ticket math: line amounts, tax, shop supplies, payments, balance.
   Pure functions only — nothing in here touches React, the DOM, or
   storage. The front desk calls these; so do the tests in tests/. */

export const STATUS = {
  estimate: "estimate", // quoted, nothing authorized yet
  open: "open", // authorized repair order, work in progress
  invoiced: "invoiced", // posted; stock pulled, number final, totals frozen
  void: "void", // cancelled after posting; kept for the audit trail
  deleted: "deleted", // an estimate or repair order thrown away before posting; hidden everywhere
};

export const LINE_KINDS = ["part", "labor", "sublet", "fee", "discount", "note"];
export const PAY_METHODS = ["cash", "card", "check", "other"];

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);

export function statusLabel(status) {
  return { estimate: "Estimate", open: "Repair order", invoiced: "Invoice", void: "Void", deleted: "Deleted" }[status] || status;
}
export function orderTitle(order) {
  const short = { estimate: "Estimate", open: "RO", invoiced: "Invoice", void: "Void", deleted: "Deleted" }[order.status] || "";
  return `${short} #${order.number}`;
}

/* ---------- lines ---------- */
export function makeLine(kind, cfg, extra = {}) {
  const base = { id: extra.id || "", kind, description: "", taxable: null, job: "" };
  if (kind === "part")
    return { ...base, number: "", partId: null, qty: 1, price: 0, cost: 0, ...extra };
  if (kind === "labor")
    return { ...base, hours: 1, rate: num(cfg?.laborRate), techId: null, ...extra };
  if (kind === "sublet") return { ...base, qty: 1, price: 0, cost: 0, vendorId: null, ...extra };
  if (kind === "fee") return { ...base, qty: 1, price: 0, ...extra };
  if (kind === "discount") return { ...base, qty: 1, price: 0, ...extra };
  return { ...base, ...extra };
}

export function lineAmount(line) {
  if (!line || line.kind === "note") return 0;
  if (line.kind === "labor") return round2(num(line.hours) * num(line.rate));
  return round2(num(line.qty) * num(line.price));
}
export function lineCost(line) {
  if (!line) return 0;
  if (line.kind === "part" || line.kind === "sublet") return round2(num(line.qty) * num(line.cost));
  return 0;
}

/* A line's own taxable flag wins; otherwise the shop rule for its kind. */
export function lineTaxable(line, rules) {
  if (!line || line.kind === "note") return false;
  if (line.taxable === true || line.taxable === false) return line.taxable;
  if (line.kind === "part") return rules.partsTaxable !== false;
  if (line.kind === "labor") return !!rules.laborTaxable;
  if (line.kind === "sublet") return !!rules.subletTaxable;
  if (line.kind === "fee") return false;
  if (line.kind === "discount") return true; // a discount reduces the taxable base unless told otherwise
  return false;
}

/* The rules a ticket is priced under. Posting an invoice freezes a copy
   on the order so later changes to settings never move a closed ticket. */
export function rulesFor(order, cfg, customer) {
  if (order && order.rules) return order.rules;
  return snapshotRules(cfg, customer);
}
export function snapshotRules(cfg, customer) {
  return {
    taxRate: num(cfg.taxRate),
    partsTaxable: cfg.partsTaxable !== false,
    laborTaxable: !!cfg.laborTaxable,
    subletTaxable: !!cfg.subletTaxable,
    suppliesPct: num(cfg.suppliesPct),
    suppliesCap: num(cfg.suppliesCap),
    suppliesTaxable: cfg.suppliesTaxable !== false,
    taxExempt: !!(customer && customer.taxExempt),
  };
}

/* ---------- totals ---------- */
export function orderTotals(order, cfg, customer) {
  const rules = rulesFor(order, cfg || {}, customer);
  const lines = (order && order.lines) || [];
  const sums = { part: 0, labor: 0, sublet: 0, fee: 0, discount: 0 };
  let taxable = 0;
  let cost = 0;
  for (const l of lines) {
    if (l.kind === "note") continue;
    const amt = lineAmount(l);
    sums[l.kind] = round2((sums[l.kind] || 0) + amt);
    cost += lineCost(l);
    if (lineTaxable(l, rules)) taxable += l.kind === "discount" ? -amt : amt;
  }
  let supplies = 0;
  if (order && order.noSupplies !== true && rules.suppliesPct > 0) {
    supplies = round2((sums.labor * rules.suppliesPct) / 100);
    if (rules.suppliesCap > 0) supplies = Math.min(supplies, rules.suppliesCap);
    if (rules.suppliesTaxable) taxable += supplies;
  }
  taxable = Math.max(0, round2(taxable));
  const taxRate = rules.taxExempt ? 0 : rules.taxRate;
  /* an invoice imported from another system keeps the tax it actually
     charged, so old paperwork and our screen never disagree */
  const tax = order && order.taxOverride != null ? round2(order.taxOverride) : round2((taxable * taxRate) / 100);
  const subtotal = round2(sums.part + sums.labor + sums.sublet + sums.fee - sums.discount + supplies);
  const total = round2(subtotal + tax);
  const paid = round2(((order && order.payments) || []).reduce((a, p) => a + num(p.amount), 0));
  return {
    parts: sums.part,
    labor: sums.labor,
    sublet: sums.sublet,
    fees: sums.fee,
    discounts: sums.discount,
    supplies,
    subtotal,
    taxable,
    taxRate,
    tax,
    total,
    paid,
    balance: round2(total - paid),
    cost: round2(cost),
    profit: round2(sums.part + sums.labor + sums.sublet + sums.fee - sums.discount - cost),
  };
}

/* Labor hours on the ticket, for productivity reports. Per-unit labor
   (so much a tire) isn't clock time and is left out. */
export function laborHours(order) {
  return round2(
    ((order && order.lines) || []).filter((l) => l.kind === "labor" && !l.unit).reduce((a, l) => a + num(l.hours), 0)
  );
}

/* ---------- status ---------- */
export function canTransition(from, to) {
  return (
    (from === "estimate" && to === "open") ||
    (from === "open" && to === "estimate") ||
    ((from === "estimate" || from === "open") && to === "invoiced") ||
    ((from === "estimate" || from === "open") && to === "deleted") ||
    (from === "invoiced" && to === "void")
  );
}

/* Stock movements an invoice causes: one entry per inventory part. Parts
   typed in by hand (no partId) don't touch inventory. */
export function stockMoves(order) {
  const byPart = new Map();
  for (const l of (order && order.lines) || []) {
    if (l.kind !== "part" || !l.partId) continue;
    byPart.set(l.partId, round2((byPart.get(l.partId) || 0) + num(l.qty)));
  }
  return [...byPart].map(([partId, qty]) => ({ partId, qty }));
}

/* Expand a canned job into fresh lines priced at today's rates. A job
   line may carry its own price; otherwise the inventory part's price is
   used when there is one, and labor falls back to the shop rate.

   A job can be priced per unit (`job.unit`, e.g. "tire"): lines marked
   `perUnit` have their qty or hours multiplied by `count`. Labor on such
   a line is a flat amount per unit, so `hours` holds the count and the
   line carries `unit` so screens say "4 tires", not "4 hr". */
export function jobLines(job, cfg, parts, mkId, count = 1) {
  const n = Math.max(1, num(count) || 1);
  const out = [];
  for (const t of (job && job.lines) || []) {
    const part = t.partId && parts ? parts[t.partId] : null;
    const scaled = job.unit && t.perUnit;
    const mult = scaled ? n : 1;
    const extra = {
      ...t,
      id: mkId(),
      job: job.name,
      description: t.description || (part ? part.description : ""),
      number: t.number || (part ? part.number : ""),
      price: t.price != null ? t.price : part ? num(part.price) : 0,
      cost: t.cost != null ? t.cost : part ? num(part.cost) : 0,
      rate: t.rate != null ? t.rate : num(cfg.laborRate),
    };
    delete extra.perUnit;
    if (t.kind === "labor") {
      extra.hours = round2((t.hours == null ? 1 : num(t.hours)) * mult);
      if (scaled) extra.unit = job.unit;
    } else if (t.kind !== "note") {
      extra.qty = round2((t.qty == null ? 1 : num(t.qty)) * mult);
    }
    out.push(makeLine(t.kind, cfg, extra));
  }
  return out;
}

/* "4 tires" for per-unit labor, "1.5 hr" otherwise. */
export function laborQtyText(line) {
  const h = num(line.hours);
  if (line.unit) return `${h} ${line.unit}${h === 1 ? "" : "s"}`;
  return `${h} hr`;
}

/* ---------- money ---------- */
export function fmtMoney(n) {
  const v = round2(n);
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `-$${s}` : `$${s}`;
}
