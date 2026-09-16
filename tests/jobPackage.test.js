import { test } from "node:test";
import assert from "node:assert/strict";
import { jobLines, orderTotals, lineAmount } from "../src/lib/invoice.js";
import { hasOilChange } from "../src/lib/sticker.js";

let n = 0;
const mkId = () => `L${++n}`;
const cfg = { taxRate: 8, laborRate: 120, partsTaxable: true, laborTaxable: false };
const parts = { atf: { id: "atf", number: "VV-ATF", description: "Valvoline ATF", price: 9.99, cost: 4 } };

/* A transmission flush set up like an oil change: one set price, the fluid
   is the taxable part, the rest is untaxed service labor. */
const transJob = {
  name: "Transmission fluid exchange",
  category: "Transmission services",
  packagePrice: 189.99,
  lines: [
    { kind: "part", partId: "atf", qty: 12, price: null, cost: null, condition: "new" },
    { kind: "labor", description: "Transmission fluid exchange", hours: 1, rate: null },
  ],
};

test("a set-price job splits into taxable parts + untaxed service labor, totaling the set price", () => {
  n = 0;
  const lines = jobLines(transJob, cfg, parts, mkId);
  const part = lines.find((l) => l.kind === "part");
  const labor = lines.find((l) => l.kind === "labor");

  assert.equal(lineAmount(part), 119.88); // 12 × 9.99 retail
  assert.equal(part.taxable, true);
  assert.equal(part.packaged, true);

  assert.equal(labor.taxable, false); // service labor is not taxed
  assert.equal(labor.packaged, true);
  assert.equal(lineAmount(labor), 70.11); // 189.99 − 119.88

  const t = orderTotals({ lines, noSupplies: true }, cfg);
  assert.equal(t.subtotal, 189.99); // customer pays the set price
  assert.equal(t.taxable, 119.88); // only the fluid is taxed
  assert.equal(t.tax, 9.59); // 119.88 × 8%
  assert.equal(t.total, 199.58);
});

test("the service labor's description comes from the job's labor line", () => {
  n = 0;
  const labor = jobLines(transJob, cfg, parts, mkId).find((l) => l.kind === "labor");
  assert.equal(labor.description, "Transmission fluid exchange");
  assert.equal(labor.unit, "service"); // a flat service, not clock hours
});

test("with no labor line the service label falls back to the job name", () => {
  n = 0;
  const job = { name: "Coolant flush", packagePrice: 129.99, lines: [{ kind: "part", partId: "atf", qty: 5 }] };
  const labor = jobLines(job, cfg, parts, mkId).find((l) => l.kind === "labor");
  assert.equal(labor.description, "Coolant flush");
});

test("parts listing over the set price scale down to it, with no labor left", () => {
  n = 0;
  const job = { name: "Underpriced", packagePrice: 50, lines: [{ kind: "part", partId: "atf", qty: 12 }] };
  const lines = jobLines(job, cfg, parts, mkId);
  const labor = lines.find((l) => l.kind === "labor");
  const t = orderTotals({ lines, noSupplies: true }, cfg);
  assert.equal(lineAmount(labor), 0);
  assert.ok(Math.abs(t.subtotal - 50) <= 0.05); // ties out to the set price within rounding
  assert.equal(t.taxable, t.subtotal); // all of it is the taxable parts
});

test("a folded fluid package is not mistaken for an oil change (no sticker)", () => {
  n = 0;
  const lines = jobLines(transJob, cfg, parts, mkId);
  assert.equal(
    lines.some((l) => l.packaged),
    true
  ); // it does fold on the receipt
  assert.equal(hasOilChange({ lines }), false); // but it's not an oil change
});

test("an oil-flagged package still reads as an oil change", () => {
  const oil = { lines: [{ kind: "part", oil: true, packaged: true, qty: 5, description: "5W-30" }] };
  assert.equal(hasOilChange(oil), true);
});
