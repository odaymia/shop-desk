import test from "node:test";
import assert from "node:assert/strict";
import { countCategories, countItems, countVariance, applyCounts } from "../src/lib/inventoryCount.js";

const PARTS = {
  a: { id: "a", number: "VO123", description: "Oil filter", category: "Oil Filters", cost: 3, onHand: 10, location: "A1" },
  b: { id: "b", number: "AF200", description: "Engine air filter", category: "Engine Air Filters", cost: 6, onHand: 5, location: "B2" },
  c: { id: "c", number: "VO050", description: "Oil filter small", category: "Oil Filters", cost: 2.5, onHand: 8, location: "A2" },
  t: { id: "t", number: "TIRE1", description: "Tire", tire: true, cost: 80, onHand: 4 },
  x: { id: "x", number: "OLD", description: "Discontinued", category: "Parts", cost: 9, onHand: 1, active: false },
};

test("countCategories: only active, non-tire, sorted", () => {
  assert.deepEqual(countCategories(PARTS), ["Engine Air Filters", "Oil Filters"]);
});

test("countItems: category filter, snapshot, order by category then number", () => {
  const all = countItems(PARTS, "all");
  assert.deepEqual(all.map((i) => i.id), ["b", "c", "a"]); // Engine Air (b), then Oil Filters by number VO050(c), VO123(a)
  assert.equal(all[0].expected, 5);
  assert.equal(all[2].cost, 3);
  // tire and inactive excluded
  assert.ok(!all.some((i) => i.id === "t" || i.id === "x"));
  const oil = countItems(PARTS, "Oil Filters");
  assert.deepEqual(oil.map((i) => i.id), ["c", "a"]);
});

test("countVariance: off lines, biggest dollar swing first, and totals", () => {
  const items = countItems(PARTS, "all"); // b(exp5,$6) c(exp8,$2.5) a(exp10,$3)
  const counts = { b: 3, c: 8, a: 13 }; // b short 2 (-$12), c exact, a over 3 (+$9)
  const v = countVariance(items, counts);
  assert.equal(v.offCount, 2); // c is exact, excluded
  assert.equal(v.countedItems, 3);
  assert.deepEqual(v.lines.map((l) => l.id), ["b", "a"]); // |−12| before |+9|
  assert.equal(v.lines[0].diff, -2);
  assert.equal(v.lines[0].diffValue, -12);
  assert.equal(v.lines[1].diff, 3);
  assert.equal(v.lines[1].diffValue, 9);
  assert.equal(v.netUnits, 1); // -2 + 3
  assert.equal(v.absUnits, 5); // 2 + 3
  assert.equal(v.netValue, -3); // -12 + 9
  assert.equal(v.shortValue, 12);
  assert.equal(v.overValue, 9);
});

test("countVariance: uncounted items are ignored, not treated as zero", () => {
  const items = countItems(PARTS, "all");
  const v = countVariance(items, { b: "" }); // blank = not counted
  assert.equal(v.offCount, 0);
  assert.equal(v.countedItems, 0);
  assert.equal(v.netValue, 0);
});

test("applyCounts: sets on-hand from counts, keeps other fields, skips uncounted", () => {
  const items = countItems(PARTS, "all");
  const updates = applyCounts(PARTS, items, { b: 3, a: 13 }); // c uncounted
  assert.equal(updates.length, 2);
  const b = updates.find((u) => u.id === "b");
  assert.equal(b.onHand, 3);
  assert.equal(b.description, "Engine air filter"); // untouched
  assert.equal(b.cost, 6);
  assert.ok(!updates.some((u) => u.id === "c"));
});
