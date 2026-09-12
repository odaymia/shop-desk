import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_OIL_PACKAGES, oilPackageLines, oilItems } from "../src/lib/oilchange.js";
import { orderTotals } from "../src/lib/invoice.js";

const cfg = { taxRate: 7.75, partsTaxable: true, laborTaxable: false, suppliesPct: 0 };
const conv = DEFAULT_OIL_PACKAGES[0];

test("with no oil or filter chosen, the package is service labor and carries no tax yet", () => {
  let n = 0;
  const lines = oilPackageLines(conv, 5, null, null, () => `L${++n}`);
  assert.equal(lines.length, 3);
  const t = orderTotals({ lines, noSupplies: true }, cfg);
  assert.equal(t.labor, 54.99);
  assert.equal(t.parts, 0);
  assert.equal(t.taxable, 0); // labor isn't taxed; parts aren't priced yet
  assert.equal(t.total, 54.99);
});

test("tax falls only on the oil and filter, never the labor, and the price still ties out", () => {
  const oil = { id: "o1", number: "VAL-5W30", description: "Valvoline 5W-30, qt", price: 6.99, cost: 3.1 };
  const filt = { id: "f1", number: "PH3614", description: "Oil filter", price: 9.99, cost: 4 };
  let n = 0;
  const lines = oilPackageLines(conv, 5, oil, filt, () => `L${++n}`);
  const t = orderTotals({ lines, noSupplies: true }, cfg);
  assert.equal(t.parts, 44.94); // 5 × 6.99 + 9.99
  assert.equal(t.labor, 10.05); // 54.99 − 44.94
  assert.equal(t.taxable, 44.94); // only the oil and filter
  assert.equal(t.subtotal, 54.99); // customer's package price, unchanged
  assert.equal(t.tax, 3.48); // 44.94 × 7.75%
  assert.equal(t.total, 58.47);
});

test("if the parts list above the package price, the package is fully taxable and labor is zero", () => {
  const oil = { id: "o", description: "pricey oil, qt", price: 12, cost: 5 };
  const filt = { id: "f", description: "filter", price: 8, cost: 3 };
  let n = 0;
  const lines = oilPackageLines(conv, 5, oil, filt, () => `L${++n}`); // 5×12 + 8 = 68 > 54.99
  const t = orderTotals({ lines, noSupplies: true }, cfg);
  assert.equal(t.labor, 0);
  assert.equal(t.subtotal, 54.99);
  assert.equal(t.taxable, 54.99);
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

test("the package's service, oil, and filter lines are marked to fold into one receipt line at the package price; extra quarts aren't", () => {
  const oil = { id: "o1", description: "oil qt", price: 6.99, cost: 3.1 };
  const filt = { id: "f1", description: "filter", price: 9.99, cost: 4 };
  let n = 0;
  const lines = oilPackageLines(conv, 6.5, oil, filt, () => `L${++n}`); // 6.5 qt → an extra-quart line
  const packaged = lines.filter((l) => l.packaged);
  const rest = lines.filter((l) => !l.packaged);
  assert.equal(packaged.length, 3); // service labor + oil + filter
  assert.equal(rest.length, 1); // the extra half-quart
  assert.match(rest[0].description, /Extra oil/);
  const pkgAmt = Math.round(packaged.reduce((a, l) => a + (l.kind === "labor" ? l.hours * l.rate : l.qty * l.price), 0) * 100) / 100;
  assert.equal(pkgAmt, 54.99); // the folded line shows the package price
});

import { detectOilType, oilTypeOf, packageOilType, oilsForPackage } from "../src/lib/oilchange.js";

test("oil type is read from the name; a plain grade counts as conventional", () => {
  assert.equal(detectOilType("Valvoline Conventional 5W-30"), "conventional");
  assert.equal(detectOilType("Valvoline Full Synthetic 5W-30"), "synthetic");
  assert.equal(detectOilType("Valvoline Synthetic Blend 5W-20"), "blend");
  assert.equal(detectOilType("Valvoline MaxLife 5W-30"), "maxlife");
  assert.equal(detectOilType("High Mileage 10W-30"), "maxlife");
  assert.equal(detectOilType("VALV ADVANCED SYN 5W-30"), "synthetic");
  assert.equal(detectOilType("5W-30"), null); // no type word
  assert.equal(oilTypeOf({ description: "5W-30" }), "conventional"); // defaulted for filtering
});

test("a conventional package offers only conventional oils, never synthetic or blend", () => {
  const convPkg = DEFAULT_OIL_PACKAGES[0];
  const synPkg = DEFAULT_OIL_PACKAGES[2];
  const oils = [
    { id: "c", description: "Valvoline Conventional 5W-30" },
    { id: "p", description: "5W-30 (store brand)" }, // plain → conventional
    { id: "b", description: "Valvoline Synthetic Blend 5W-20" },
    { id: "s", description: "Valvoline Full Synthetic 5W-30" },
    { id: "m", description: "Valvoline MaxLife 5W-30" },
  ];
  assert.equal(packageOilType(convPkg), "conventional");
  assert.deepEqual(oilsForPackage(oils, convPkg).map((o) => o.id), ["c", "p"]);
  assert.deepEqual(oilsForPackage(oils, synPkg).map((o) => o.id), ["s"]);
});

test("a package with no type word in its name filters nothing", () => {
  const generic = { id: "x", name: "Oil Change", quarts: 5, price: 40, extraQuart: 5 };
  const oils = [{ id: "s", description: "Full Synthetic 0W-20" }, { id: "c", description: "Conventional 5W-30" }];
  assert.equal(packageOilType(generic), null);
  assert.deepEqual(oilsForPackage(oils, generic).map((o) => o.id), ["s", "c"]);
});
