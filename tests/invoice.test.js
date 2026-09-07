import { test } from "node:test";
import assert from "node:assert/strict";
import { orderTotals, lineAmount, lineTaxable, stockMoves, canTransition, jobLines, makeLine, fmtMoney, laborHours, laborQtyText } from "../src/lib/invoice.js";

const cfg = {
  laborRate: 150,
  taxRate: 7.75,
  partsTaxable: true,
  laborTaxable: false,
  subletTaxable: false,
  suppliesPct: 5,
  suppliesCap: 25,
  suppliesTaxable: true,
};

const oilChange = {
  status: "open",
  lines: [
    { id: "a", kind: "part", description: "5W-30 full synthetic, 5 qt", qty: 1, price: 34.99, cost: 21.5, partId: "oil" },
    { id: "b", kind: "part", description: "Oil filter", qty: 1, price: 9.99, cost: 4.1, partId: "filt" },
    { id: "c", kind: "labor", description: "Lube, oil, filter", hours: 0.5, rate: 150 },
  ],
  payments: [],
};

test("line amounts: parts are qty × price, labor is hours × rate", () => {
  assert.equal(lineAmount(oilChange.lines[0]), 34.99);
  assert.equal(lineAmount(oilChange.lines[2]), 75);
  assert.equal(lineAmount({ kind: "note" }), 0);
});

test("taxability follows the shop rule unless the line overrides it", () => {
  assert.equal(lineTaxable({ kind: "part" }, cfg), true);
  assert.equal(lineTaxable({ kind: "labor" }, cfg), false);
  assert.equal(lineTaxable({ kind: "labor", taxable: true }, cfg), true);
  assert.equal(lineTaxable({ kind: "part", taxable: false }, cfg), false);
  assert.equal(lineTaxable({ kind: "fee" }, cfg), false);
});

test("totals: parts taxed, labor not, supplies 5% of labor and taxable", () => {
  const t = orderTotals(oilChange, cfg, null);
  assert.equal(t.parts, 44.98);
  assert.equal(t.labor, 75);
  assert.equal(t.supplies, 3.75);
  assert.equal(t.taxable, 48.73);
  assert.equal(t.tax, 3.78);
  assert.equal(t.subtotal, 123.73);
  assert.equal(t.total, 127.51);
  assert.equal(t.balance, 127.51);
  assert.equal(t.cost, 25.6);
});

test("supplies cap holds", () => {
  const big = { lines: [{ kind: "labor", hours: 10, rate: 150 }] };
  assert.equal(orderTotals(big, cfg).supplies, 25);
  assert.equal(orderTotals({ ...big, noSupplies: true }, cfg).supplies, 0);
});

test("tax-exempt customer pays no tax; frozen rules beat current settings", () => {
  const exempt = orderTotals(oilChange, cfg, { taxExempt: true });
  assert.equal(exempt.tax, 0);
  const frozen = { ...oilChange, rules: { ...cfg, taxRate: 8.75, taxExempt: false } };
  assert.equal(orderTotals(frozen, { ...cfg, taxRate: 0 }).tax, 4.26);
});

test("discounts come off the taxable base but never below zero", () => {
  const o = {
    lines: [
      { kind: "part", qty: 1, price: 100 },
      { kind: "discount", description: "Coupon", qty: 1, price: 120 },
    ],
  };
  const t = orderTotals(o, { ...cfg, suppliesPct: 0 });
  assert.equal(t.discounts, 120);
  assert.equal(t.taxable, 0);
  assert.equal(t.total, -20);
});

test("payments reduce the balance; overpayment shows negative", () => {
  const paid = { ...oilChange, payments: [{ amount: 100, method: "cash" }, { amount: 27.51, method: "card" }] };
  const t = orderTotals(paid, cfg);
  assert.equal(t.paid, 127.51);
  assert.equal(t.balance, 0);
});

test("stock moves group by part and skip hand-typed parts", () => {
  const o = { lines: [...oilChange.lines, { kind: "part", partId: "oil", qty: 2, price: 1 }, { kind: "part", qty: 1, price: 5 }] };
  assert.deepEqual(stockMoves(o), [
    { partId: "oil", qty: 3 },
    { partId: "filt", qty: 1 },
  ]);
});

test("status transitions", () => {
  assert.equal(canTransition("estimate", "open"), true);
  assert.equal(canTransition("open", "invoiced"), true);
  assert.equal(canTransition("invoiced", "open"), false);
  assert.equal(canTransition("invoiced", "void"), true);
  assert.equal(canTransition("void", "invoiced"), false);
  assert.equal(canTransition("estimate", "deleted"), true);
  assert.equal(canTransition("open", "deleted"), true);
  assert.equal(canTransition("invoiced", "deleted"), false);
  assert.equal(canTransition("deleted", "open"), false);
});

test("canned job expands with inventory prices and the shop labor rate", () => {
  const job = {
    name: "Full synthetic oil change",
    lines: [
      { kind: "part", partId: "oil", qty: 1 },
      { kind: "labor", description: "LOF", hours: 0.4 },
    ],
  };
  const parts = { oil: { number: "MOB1-5W30", description: "Mobil 1 5W-30", price: 39.99, cost: 24 } };
  let n = 0;
  const lines = jobLines(job, cfg, parts, () => `L${++n}`);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].price, 39.99);
  assert.equal(lines[0].number, "MOB1-5W30");
  assert.equal(lines[0].job, "Full synthetic oil change");
  assert.equal(lines[1].rate, 150);
  assert.equal(lines[1].id, "L2");
});

test("makeLine defaults", () => {
  assert.equal(makeLine("labor", cfg).rate, 150);
  assert.equal(makeLine("part", cfg).qty, 1);
});

test("money formatting", () => {
  assert.equal(fmtMoney(1234.5), "$1,234.50");
  assert.equal(fmtMoney(-3), "-$3.00");
});

test("starter brake jobs sell for $219.99 before supplies and tax", async () => {
  const { STARTER_JOBS } = await import("../src/lib/starterJobs.js");
  const pads = STARTER_JOBS.filter((j) => /pads/.test(j.starterKey));
  assert.equal(pads.length, 2);
  for (const job of pads) {
    const lines = jobLines(job, { laborRate: 150 }, {}, () => "x");
    const t = orderTotals({ lines, noSupplies: true }, { ...cfg, taxRate: 0 });
    assert.equal(t.parts, 49.99, job.name);
    assert.equal(t.labor, 170, job.name);
    assert.equal(t.total, 219.99, job.name);
  }
});

test("tire job: 4 tires multiplies the tire, the $25 labor, and the $1.75 fee", async () => {
  const { STARTER_JOBS } = await import("../src/lib/starterJobs.js");
  const tires = STARTER_JOBS.find((j) => j.starterKey === "tires");
  const lines = jobLines(tires, { laborRate: 150 }, {}, () => "x", 4);
  const tire = lines.find((l) => l.kind === "part");
  const labor = lines.find((l) => l.kind === "labor");
  const fee = lines.find((l) => l.kind === "fee");
  assert.equal(tire.qty, 4);
  assert.equal(labor.hours, 4);
  assert.equal(labor.rate, 25);
  assert.equal(labor.unit, "tire");
  assert.equal(laborQtyText(labor), "4 tires");
  assert.equal(fee.qty, 4);
  assert.equal(fee.price, 1.75);
  tire.price = 120; // typed on the ticket
  const t = orderTotals({ lines, noSupplies: true }, { ...cfg, taxRate: 7.75 });
  assert.equal(t.parts, 480);
  assert.equal(t.labor, 100);
  assert.equal(t.fees, 7);
  assert.equal(t.taxable, 480); // fee and labor are not taxed
  assert.equal(t.tax, 37.2);
  assert.equal(t.total, 624.2);
  assert.equal(laborHours({ lines }), 0); // per-tire labor isn't clock hours
  assert.equal(laborQtyText({ hours: 1.5 }), "1.5 hr");
});

test("a job with no unit ignores the count", () => {
  const job = { name: "Fixed", lines: [{ kind: "labor", hours: 1, rate: 100 }] };
  assert.equal(jobLines(job, cfg, {}, () => "x", 4)[0].hours, 1);
});

test("an imported invoice keeps the tax the old system charged", () => {
  const o = { lines: [{ kind: "part", qty: 1, price: 100 }], taxOverride: 8.13, rules: { ...cfg, taxRate: 7.75, suppliesPct: 0 } };
  const t = orderTotals(o, cfg);
  assert.equal(t.tax, 8.13);
  assert.equal(t.total, 108.13);
  assert.equal(orderTotals({ ...o, taxOverride: null }, cfg).tax, 7.75);
});
