import { test } from "node:test";
import assert from "node:assert/strict";
import { blankCoupon, couponApplies, couponDiscount, applicableCoupons, orderJobNames, orderSubtotalBase, eligibleBase } from "../src/lib/coupons.js";

const oilTicket = {
  lines: [
    { kind: "labor", job: "Valvoline Full Synthetic Oil Change", hours: 1, rate: 40 },
    { kind: "part", job: "Valvoline Full Synthetic Oil Change", qty: 1, price: 59.99 },
    { kind: "labor", job: "Engine air filter replacement", hours: 0.2, rate: 50 },
    { kind: "part", job: "Engine air filter replacement", qty: 1, price: 24.99 },
  ],
};
// subtotal = 40 + 59.99 + 10 + 24.99 = 134.98

test("subtotal base sums the priced lines, ignoring notes/discounts", () => {
  assert.equal(orderSubtotalBase(oilTicket), 134.98);
});

test("percent coupon takes its percent off the whole ticket", () => {
  const c = { ...blankCoupon(), kind: "percent", value: 10 };
  assert.equal(couponDiscount(c, oilTicket), 13.5); // 10% of 134.98
});

test("flat coupon takes a flat amount, capped at the subtotal", () => {
  const c = { ...blankCoupon(), kind: "amount", value: 15 };
  assert.equal(couponDiscount(c, oilTicket), 15);
  const big = { ...blankCoupon(), kind: "amount", value: 500 };
  assert.equal(couponDiscount(big, oilTicket), 134.98); // capped
});

test("a percent coupon scoped to eligible services only discounts those lines", () => {
  const c = { ...blankCoupon(), kind: "percent", value: 50, applyTo: "eligible", requireAny: ["Engine air filter replacement"] };
  // eligible base = 10 + 24.99 = 34.99; 50% = 17.50 (rounded)
  assert.equal(eligibleBase(c, oilTicket), 34.99);
  assert.equal(couponDiscount(c, oilTicket), 17.5);
});

const ctx = (over) => ({ jobNames: orderJobNames(oilTicket), isFirstTime: true, subtotal: orderSubtotalBase(oilTicket), now: Date.parse("2026-06-15T12:00:00"), ...over });

test("a coupon requiring a service applies only when that service is on the ticket", () => {
  const needsBrakes = { ...blankCoupon(), requireAny: ["Brake fluid flush"] };
  assert.equal(couponApplies(needsBrakes, ctx()), false);
  const needsOil = { ...blankCoupon(), requireAny: ["Valvoline Full Synthetic Oil Change"] };
  assert.equal(couponApplies(needsOil, ctx()), true);
});

test("first-time-only coupons are gated on the customer being new", () => {
  const c = { ...blankCoupon(), firstTimeOnly: true };
  assert.equal(couponApplies(c, ctx({ isFirstTime: true })), true);
  assert.equal(couponApplies(c, ctx({ isFirstTime: false })), false);
});

test("date window gates the coupon", () => {
  const c = { ...blankCoupon(), startsAt: "2026-07-01", endsAt: "2026-07-31" };
  assert.equal(couponApplies(c, ctx({ now: Date.parse("2026-06-15T12:00:00") })), false); // before
  assert.equal(couponApplies(c, ctx({ now: Date.parse("2026-07-15T12:00:00") })), true); // within
  assert.equal(couponApplies(c, ctx({ now: Date.parse("2026-08-15T12:00:00") })), false); // after
});

test("minimum subtotal gates the coupon", () => {
  const c = { ...blankCoupon(), minSubtotal: 200 };
  assert.equal(couponApplies(c, ctx({ subtotal: 134.98 })), false);
  assert.equal(couponApplies(c, ctx({ subtotal: 250 })), true);
});

test("inactive coupons never apply", () => {
  assert.equal(couponApplies({ ...blankCoupon(), active: false }, ctx()), false);
});

test("applicableCoupons returns only the ones that fit, sorted", () => {
  const coupons = {
    a: { ...blankCoupon(), id: "a", code: "OIL5", kind: "amount", value: 5 },
    b: { ...blankCoupon(), id: "b", code: "BRAKES", requireAny: ["Brake fluid flush"] },
    c: { ...blankCoupon(), id: "c", code: "NEW20", firstTimeOnly: true, kind: "percent", value: 20 },
    d: { ...blankCoupon(), id: "d", code: "OFF", active: false },
  };
  const out = applicableCoupons(coupons, ctx());
  assert.deepEqual(out.map((c) => c.code), ["NEW20", "OIL5"]); // BRAKES not on ticket, OFF inactive
});
