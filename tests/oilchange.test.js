import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_OIL_PACKAGES, oilPackageLines, oilItems } from "../src/lib/oilchange.js";
import { orderTotals } from "../src/lib/invoice.js";

const cfg = { taxRate: 7.75, partsTaxable: true, laborTaxable: false, suppliesPct: 0 };
const conv = DEFAULT_OIL_PACKAGES[0];

test("a 5-quart conventional oil change is the package price plus tax", () => {
  let n = 0;
  const lines = oilPackageLines(conv, 5, null, null, () => `L${++n}`);
  assert.equal(lines.length, 3);
  const t = orderTotals({ lines, noSupplies: true }, cfg);
  assert.equal(t.labor, 54.99);
  assert.equal(t.parts, 0);
  assert.equal(t.taxable, 54.99);
  assert.equal(t.total, 59.25);
});

test("a 6.5-quart car pays the extra quarts at the package rate, stock links carry", () => {
  const oil = { id: "o1", number: "VAL-5W30", description: "Valvoline 5W-30 conventional, quart", cost: 3.1 };
  const filt = { id: "f1", number: "PH3614", description: "Oil filter", cost: 4 };
  let n = 0;
  const lines = oilPackageLines(conv, 6.5, oil, filt, () => `L${++n}`);
  assert.equal(lines.length, 4);
  assert.equal(lines[1].partId, "o1");
  assert.equal(lines[1].qty, 5);
  assert.equal(lines[2].partId, "f1");
  assert.equal(lines[3].qty, 1.5);
  assert.equal(lines[3].price, 4.99);
  const t = orderTotals({ lines, noSupplies: true }, cfg);
  assert.equal(t.parts, 7.49); // 1.5 × 4.99, rounded
  assert.equal(t.labor, 54.99);
  assert.equal(t.cost, 5 * 3.1 + 4 + 1.5 * 3.1);
});

test("synthetic package rates", () => {
  const syn = DEFAULT_OIL_PACKAGES[2];
  const lines = oilPackageLines(syn, 8, null, null, () => "x");
  assert.equal(lines[0].rate, 99.99);
  assert.equal(lines[3].price, 9.99);
  assert.equal(lines[3].qty, 3);
});

test("oil items are found by category or grade", () => {
  const parts = { a: { id: "a", category: "Oil", description: "Bulk conventional" }, b: { id: "b", category: "", description: "Mobil 1 0W-20 quart" }, c: { id: "c", category: "Filters", description: "Oil filter" } };
  assert.deepEqual(oilItems(parts).map((p) => p.id), ["a", "b"]);
});
