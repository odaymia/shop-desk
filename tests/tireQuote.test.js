import { test } from "node:test";
import assert from "node:assert/strict";
import { sizeForVehicle, tiresForSize, stockedSizes, tireQuoteLines, quoteSubtotal, DEFAULT_TIRE_ADDONS, tireAddOns } from "../src/lib/tireQuote.js";
import { orderTotals } from "../src/lib/invoice.js";

const parts = {
  t1: { id: "t1", tire: true, brand: "Ironman", model: "iMove", size: "225/65R17", loadSpeed: "102H", price: 110, cost: 70, onHand: 6, number: "IM2256517" },
  t2: { id: "t2", tire: true, brand: "Michelin", model: "Defender", size: "225/65r17", price: 210, cost: 150, onHand: 0 },
  t3: { id: "t3", tire: true, brand: "Ironman", model: "iMove", size: "205/55R16", price: 90, onHand: 4 },
  f1: { id: "f1", description: "Oil filter", price: 7 },
};

test("the size comes from the car, else the last tire it was sold", () => {
  assert.deepEqual(sizeForVehicle({ tireSize: "p225 65 17" }, [], parts), { size: "225/65R17", from: "car" });
  const orders = [
    { status: "invoiced", invoicedAt: 1, lines: [{ partId: "t3" }] },
    { status: "invoiced", invoicedAt: 5, lines: [{ partId: "f1" }, { partId: "t1" }] },
  ];
  assert.equal(sizeForVehicle({}, orders, parts).size, "225/65R17");
  assert.equal(sizeForVehicle({}, [], parts).size, "");
});

test("inventory by size, cheapest first; stocked sizes smallest rim first", () => {
  assert.deepEqual(tiresForSize(parts, "225 65 17").map((p) => p.id), ["t1", "t2"]);
  assert.deepEqual(stockedSizes(parts), [{ size: "205/55R16", onHand: 4 }, { size: "225/65R17", onHand: 6 }]);
});

test("a quote becomes one job: tires and per-tire add-ons multiply, per-ticket ones don't", () => {
  let n = 0;
  const id = () => `L${++n}`;
  const picked = DEFAULT_TIRE_ADDONS.filter((a) => ["mount", "catire", "hazard", "align"].includes(a.id));
  const { job, lines } = tireQuoteLines({ tire: parts.t1, size: "225/65R17", count: 4, picked, cfg: {}, id });
  assert.equal(job, "Tires: Ironman iMove 225/65R17 × 4");
  assert.ok(lines.every((l) => l.job === job));
  const tire = lines[0];
  assert.equal(tire.kind, "part");
  assert.equal(tire.partId, "t1");
  assert.equal(tire.qty, 4);
  assert.equal(tire.description, "Ironman iMove 225/65R17 102H");
  const mount = lines.find((l) => l.description.startsWith("Mount"));
  assert.equal(mount.hours, 4);
  assert.equal(mount.rate, 25);
  const align = lines.find((l) => l.description === "4-wheel alignment");
  assert.equal(align.hours, 1);
  // 4×110 + 4×25 + 4×1.75 + 4×15 + 99.99
  assert.equal(quoteSubtotal(lines), 706.99);
  // tax only on the tires (CA: parts taxable, labor and fees not)
  const t = orderTotals({ lines, noSupplies: true }, { taxRate: 10 });
  assert.equal(t.tax, 44);
});

test("a typed tire for one ordered in, and the shop's own add-on list", () => {
  let n = 0;
  const { lines } = tireQuoteLines({ tire: { description: "Toyo Open Country A/T III", price: 245 }, size: "265/70R17", count: 2, picked: [], cfg: {}, id: () => `x${++n}` });
  assert.equal(lines[0].partId, null);
  assert.equal(lines[0].description, "Toyo Open Country A/T III 265/70R17");
  assert.equal(tireAddOns({}), DEFAULT_TIRE_ADDONS);
  assert.deepEqual(tireAddOns({ tireAddOns: [{ id: "x", label: "Lug nut locks", per: "ticket", price: 30, kind: "part" }] }).map((a) => a.id), ["x"]);
});
