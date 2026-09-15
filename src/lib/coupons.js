/* Coupons and discounts. Pure — no React, no storage.

   Every discount on a ticket now comes from a coupon the shop created here,
   not a free-typed amount. A coupon carries how much it takes off (a percent
   or a flat dollar amount) and the rules for when it may be used: a date
   window, first-time customers only, a minimum ticket, and which services or
   packages have to be on the ticket. The ticket's Coupon button shows only the
   coupons that actually apply to what's on it. */

import { lineAmount } from "./invoice.js";

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const norm = (s) => String(s || "").trim().toLowerCase();

export function blankCoupon() {
  return {
    code: "",
    name: "",
    kind: "percent", // "percent" | "amount"
    value: 0,
    active: true,
    startsAt: "", // "YYYY-MM-DD" or ""
    endsAt: "",
    firstTimeOnly: false,
    minSubtotal: 0,
    requireAny: [], // service/package names; empty = applies to any ticket
    applyTo: "ticket", // "ticket" | "eligible" — what a percent is taken off
  };
}

/* The distinct service/job/package names on a ticket (a line's `job`). */
export function orderJobNames(order) {
  const set = new Set();
  for (const l of (order && order.lines) || []) {
    const n = (l.job || "").trim();
    if (n) set.add(norm(n));
  }
  return set;
}

/* The ticket total before any discount — what a percent coupon is taken off. */
export function orderSubtotalBase(order) {
  let sum = 0;
  for (const l of (order && order.lines) || []) {
    if (l.kind === "part" || l.kind === "labor" || l.kind === "sublet" || l.kind === "fee") sum += lineAmount(l);
  }
  return round2(sum);
}

/* The amount of just the lines a coupon is scoped to (its required services). */
export function eligibleBase(coupon, order) {
  const want = (coupon.requireAny || []).map(norm);
  if (!want.length) return orderSubtotalBase(order);
  let sum = 0;
  for (const l of (order && order.lines) || []) {
    if (l.kind === "note" || l.kind === "discount") continue;
    if (want.includes(norm(l.job))) sum += lineAmount(l);
  }
  return round2(sum);
}

/* Does this coupon apply, given the ticket context? ctx: { jobNames:Set,
   isFirstTime, subtotal, now } (now in ms). */
export function couponApplies(coupon, ctx) {
  if (!coupon || coupon.active === false) return false;
  const now = ctx.now || Date.now();
  if (coupon.startsAt && now < Date.parse(coupon.startsAt + "T00:00:00")) return false;
  if (coupon.endsAt && now > Date.parse(coupon.endsAt + "T23:59:59.999")) return false;
  if (coupon.firstTimeOnly && !ctx.isFirstTime) return false;
  if (coupon.minSubtotal && (ctx.subtotal || 0) < Number(coupon.minSubtotal)) return false;
  const want = (coupon.requireAny || []).map(norm);
  if (want.length) {
    const have = ctx.jobNames || new Set();
    if (!want.some((w) => have.has(w))) return false;
  }
  return true;
}

/* What a coupon takes off a given ticket, in dollars — never more than the
   base it applies to. */
export function couponDiscount(coupon, order) {
  if (!coupon) return 0;
  if (coupon.kind === "amount") {
    return round2(Math.min(Number(coupon.value) || 0, orderSubtotalBase(order)));
  }
  // percent
  const base = coupon.applyTo === "eligible" ? eligibleBase(coupon, order) : orderSubtotalBase(order);
  return round2(Math.min((base * (Number(coupon.value) || 0)) / 100, base));
}

/* The coupons that apply to this ticket right now, for the picker. */
export function applicableCoupons(coupons, ctx) {
  return Object.values(coupons || {})
    .filter((c) => couponApplies(c, ctx))
    .sort((a, b) => (a.code || a.name || "").localeCompare(b.code || b.name || ""));
}

/* "20% off" / "$15 off" */
export function couponValueText(c) {
  if (!c) return "";
  return c.kind === "amount" ? `$${(Number(c.value) || 0).toFixed(2)} off` : `${Number(c.value) || 0}% off`;
}

/* A one-line summary of a coupon's rules, for the management list. */
export function couponRulesText(c) {
  const bits = [];
  if (c.firstTimeOnly) bits.push("first-time customers");
  if (c.requireAny && c.requireAny.length) bits.push("with " + c.requireAny.join(", "));
  if (c.minSubtotal) bits.push(`min $${Number(c.minSubtotal).toFixed(2)}`);
  if (c.startsAt || c.endsAt) bits.push(`${c.startsAt || "…"} to ${c.endsAt || "…"}`);
  return bits.length ? bits.join(" · ") : "Any ticket";
}
