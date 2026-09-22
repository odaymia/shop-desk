import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PLATFORM_FEE,
  platformFeeCfg,
  platformFee,
  toCents,
  fromCents,
  cardPaymentRecord,
  cardPaymentStats,
} from "../src/lib/payments.js";

test("platformFeeCfg falls back to the default, then to overrides", () => {
  assert.deepEqual(platformFeeCfg({}), DEFAULT_PLATFORM_FEE);
  assert.deepEqual(platformFeeCfg(null), DEFAULT_PLATFORM_FEE);
  assert.deepEqual(platformFeeCfg({ payments: { platformFeePct: 1, platformFeeFixed: 0.25 } }), { pct: 1, fixed: 0.25 });
  // negatives are clamped to zero
  assert.deepEqual(platformFeeCfg({ payments: { platformFeePct: -5, platformFeeFixed: -1 } }), { pct: 0, fixed: 0 });
});

test("platformFee: percent + fixed, rounded to the cent", () => {
  // default 0.5% of $100 = $0.50
  assert.equal(platformFee(100, {}), 0.5);
  // 0.5% of $253.40 = $1.267 -> $1.27
  assert.equal(platformFee(253.4, {}), 1.27);
  // percent + fixed
  assert.equal(platformFee(200, { payments: { platformFeePct: 0.6, platformFeeFixed: 0.1 } }), round(200 * 0.006 + 0.1));
});

test("platformFee is never negative and never exceeds the sale", () => {
  assert.equal(platformFee(0, {}), 0);
  assert.equal(platformFee(-50, {}), 0); // a refund yields no fee
  // an absurd fee is capped at the sale amount
  assert.equal(platformFee(10, { payments: { platformFeePct: 500, platformFeeFixed: 100 } }), 10);
});

test("toCents / fromCents round-trip whole cents", () => {
  assert.equal(toCents(12.34), 1234);
  assert.equal(toCents(0), 0);
  assert.equal(toCents(0.1 + 0.2), 30); // no float drift
  assert.equal(fromCents(1234), 12.34);
});

test("cardPaymentRecord matches the ticket payment shape", () => {
  const r = cardPaymentRecord({ amount: 88.5, cardType: "Visa", last4: "4242", fee: 0.44, paymentIntentId: "pi_1", simulated: true });
  assert.equal(r.method, "card");
  assert.equal(r.processor, "stripe");
  assert.equal(r.amount, 88.5);
  assert.equal(r.cardType, "Visa");
  assert.equal(r.ref, "4242");
  assert.equal(r.fee, 0.44);
  assert.equal(r.piId, "pi_1");
  assert.equal(r.simulated, true);
  // a bare success still yields a sane record
  const bare = cardPaymentRecord({ amount: 10 });
  assert.equal(bare.cardType, "Card");
  assert.equal(bare.ref, "");
  assert.equal(bare.fee, 0);
});

test("cardPaymentStats sums only Stripe card payments across tickets", () => {
  const orders = [
    { payments: [{ method: "card", processor: "stripe", amount: 100, fee: 0.5 }, { method: "cash", amount: 40 }] },
    { payments: [{ method: "card", processor: "stripe", amount: 253.4, fee: 1.27 }] },
    { payments: [{ method: "card", amount: 20 }] }, // recorded manually, not through Stripe — excluded
    {}, // no payments
  ];
  const s = cardPaymentStats(orders);
  assert.equal(s.count, 2);
  assert.equal(s.gross, 353.4);
  assert.equal(s.fees, 1.77);
});

function round(n) {
  return Math.round(n * 100) / 100;
}
