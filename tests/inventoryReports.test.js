import { test } from "node:test";
import assert from "node:assert/strict";
import { salesByItem, reorderPlan } from "../src/lib/inventoryReports.js";

const DAY = 86400000;
const parts = {
  oil: { id: "oil", number: "VAL-5W30", description: "Valvoline 5W-30", category: "Oil", onHand: 20, cost: 3, price: 7 },
  filt: { id: "filt", number: "PH3614", description: "Oil filter", category: "Filters", onHand: 4, cost: 4, price: 10 },
};
// a 10-day window
const from = Date.parse("2026-09-01T00:00:00Z");
const to = from + 10 * DAY;
const mid = from + 5 * DAY;
const orders = {
  a: { id: "a", status: "invoiced", invoicedAt: mid, lines: [
    { kind: "part", partId: "oil", number: "VAL-5W30", description: "Valvoline 5W-30", qty: 5, price: 7, cost: 3 },
    { kind: "part", partId: "filt", number: "PH3614", description: "Oil filter", qty: 1, price: 10, cost: 4 },
  ] },
  b: { id: "b", status: "invoiced", invoicedAt: mid + DAY, lines: [
    { kind: "part", partId: "filt", number: "PH3614", description: "Oil filter", qty: 1, price: 10, cost: 4 },
    { kind: "part", partId: null, number: "", description: "Wiper blade", qty: 2, price: 12, cost: 5 },
  ] },
  old: { id: "old", status: "invoiced", invoicedAt: from - 5 * DAY, lines: [{ kind: "part", partId: "filt", qty: 99, price: 10, cost: 4 }] },
  est: { id: "est", status: "estimate", invoicedAt: mid, lines: [{ kind: "part", partId: "filt", qty: 50, price: 10, cost: 4 }] },
};

test("sales by item sums qty, revenue and cost, only invoiced and in range", () => {
  const rows = salesByItem(orders, parts, from, to);
  const oil = rows.find((r) => r.partId === "oil");
  const filt = rows.find((r) => r.partId === "filt");
  const wiper = rows.find((r) => /Wiper/.test(r.description));
  assert.equal(oil.qty, 5);
  assert.equal(oil.revenue, 35); // 5 × 7
  assert.equal(oil.cost, 15);
  assert.equal(oil.profit, 20);
  assert.equal(filt.qty, 2); // two invoices, the old/estimate ones excluded
  assert.equal(wiper.qty, 2); // hand-typed part still counted
  assert.equal(wiper.partId, null);
});

test("reorder planner: usage rate over the window scales to the cover period, minus on hand", () => {
  const plan = reorderPlan(orders, parts, from, to, 14);
  const filt = plan.find((r) => r.partId === "filt");
  // 2 filters over 10 days = 0.2/day; 14 days → need 2.8; on hand 4 → order 0
  assert.equal(filt.perDay, 0.2);
  assert.equal(filt.need, 2.8);
  assert.equal(filt.suggestedOrder, 0);
  const oil = plan.find((r) => r.partId === "oil");
  // 5 over 10 days = 0.5/day; 14 → need 7; on hand 20 → order 0
  assert.equal(oil.suggestedOrder, 0);
});

test("reorder planner suggests an order when on hand won't cover the period", () => {
  const plan = reorderPlan(orders, parts, from, to, 60); // cover 60 days
  const filt = plan.find((r) => r.partId === "filt");
  // 0.2/day × 60 = 12 needed; on hand 4 → order 8
  assert.equal(filt.need, 12);
  assert.equal(filt.suggestedOrder, 8);
  // hand-typed parts (no inventory link) aren't in the reorder plan
  assert.ok(!plan.some((r) => /Wiper/.test(r.description)));
});

test("filters split into oil, engine air, and cabin air categories by description", async () => {
  const { itemCategory } = await import("../src/lib/inventoryReports.js");
  assert.equal(itemCategory({ category: "Filters", description: "Engine oil filter" }), "Oil Filters");
  assert.equal(itemCategory({ category: "Filters", description: "Engine air filter element" }), "Engine Air Filters");
  assert.equal(itemCategory({ category: "Filters", description: "Cabin air filter" }), "Cabin Air Filters");
  assert.equal(itemCategory({ category: "Oil", description: "Valvoline 5W-30" }), "Oil"); // non-filters keep their category
  assert.equal(itemCategory({ category: "", description: "Wiper blade" }), "Uncategorized");
});

test("brake pads and rotors are categorized by part number", async () => {
  const { itemCategory } = await import("../src/lib/inventoryReports.js");
  assert.equal(itemCategory({ number: "SCD914", description: "Front brake pads" }), "Brake Pads");
  assert.equal(itemCategory({ number: "sc1399", description: "" }), "Brake Pads"); // case-insensitive
  assert.equal(itemCategory({ number: "BR55012RGS", description: "Front rotor" }), "Brake Rotors");
  assert.equal(itemCategory({ number: "SC", description: "too short to be a pad #" }), "Uncategorized");
  // a filter still wins by description even with a brakey number
  assert.equal(itemCategory({ number: "SC12345", description: "Oil filter" }), "Oil Filters");
});

test("purchase order rounds to whole cases/boxes and respects a bulk minimum", async () => {
  const { purchaseOrder, packQuartsOf } = await import("../src/lib/inventoryReports.js");
  // 6-quart case: need 8 qt → 2 cases (12 qt)
  assert.deepEqual(purchaseOrder(8, "case", 6), { quarts: 12, packs: 2, text: "2 cases (12 qt)" });
  // 5-gallon box = 20 qt: need 5 qt → 1 box (20 qt)
  assert.equal(packQuartsOf({ packType: "box", packSize: 5 }), 20);
  assert.equal(purchaseOrder(5, "box", 20).text, "1 box (20 qt)");
  // bulk 110 gal min = 440 qt: need 30 qt → 110 gal (min)
  assert.equal(packQuartsOf({ packType: "bulk", packSize: 110 }), 440);
  assert.equal(purchaseOrder(30, "bulk", 440).text, "110 gal bulk (min)");
  // bulk when the need is above the minimum: 500 qt → 125 gal
  assert.equal(purchaseOrder(500, "bulk", 440).text, "125 gal bulk");
  // no pack set: just the quart count
  assert.equal(purchaseOrder(8, "", 0).text, "8");
  // nothing needed
  assert.equal(purchaseOrder(0, "case", 6).text, "—");
});

test("the reorder plan carries the pack order text", async () => {
  const { reorderPlan } = await import("../src/lib/inventoryReports.js");
  const DAY = 86400000;
  const from = Date.parse("2026-09-01T00:00:00Z");
  const to = from + 10 * DAY;
  const parts = { oil: { id: "oil", number: "VAL", description: "Valvoline 5W-30", category: "Oil", onHand: 2, packType: "case", packSize: 6 } };
  const orders = { a: { id: "a", status: "invoiced", invoicedAt: from + DAY, lines: [{ kind: "part", partId: "oil", qty: 40, price: 7, cost: 3 }] } };
  const plan = reorderPlan(orders, parts, from, to, 14); // 4/day × 14 = 56 need, on hand 2 → 54 qt → 9 cases
  const oil = plan.find((r) => r.partId === "oil");
  assert.equal(oil.suggestedOrder, 54);
  assert.equal(oil.orderText, "9 cases (54 qt)");
});

test("lead time extends the horizon so the order lasts through the wait", async () => {
  const { reorderPlan } = await import("../src/lib/inventoryReports.js");
  const DAY = 86400000;
  const from = Date.parse("2026-09-01T00:00:00Z");
  const to = from + 10 * DAY;
  const parts = { f: { id: "f", number: "PH", description: "Oil filter", onHand: 4 } };
  const orders = { a: { id: "a", status: "invoiced", invoicedAt: from + DAY, lines: [{ kind: "part", partId: "f", qty: 2, price: 10, cost: 4 }] } };
  // 2 over 10 days = 0.2/day. cover 14, lead 7 → horizon 21 → need 4.2; on hand 4 → order 1
  const plan = reorderPlan(orders, parts, from, to, 14, 7);
  const f = plan.find((r) => r.partId === "f");
  assert.equal(f.horizon, 21);
  assert.equal(f.need, 4.2);
  assert.equal(f.suggestedOrder, 1);
  // with no lead time it's just the 14-day cover
  assert.equal(reorderPlan(orders, parts, from, to, 14, 0).find((r) => r.partId === "f").need, 2.8);
});

test("flags an item that runs out before the order arrives", async () => {
  const { reorderPlan } = await import("../src/lib/inventoryReports.js");
  const DAY = 86400000;
  const from = Date.parse("2026-09-01T00:00:00Z");
  const to = from + 10 * DAY;
  // sells 20 over 10 days = 2/day; on hand 3 → runs out in 1 day; lead 5 → stocks out first
  const parts = { f: { id: "f", number: "PH", description: "Oil filter", onHand: 3 } };
  const orders = { a: { id: "a", status: "invoiced", invoicedAt: from + DAY, lines: [{ kind: "part", partId: "f", qty: 20, price: 10, cost: 4 }] } };
  const f = reorderPlan(orders, parts, from, to, 14, 5).find((r) => r.partId === "f");
  assert.equal(f.daysLeft, 1);
  assert.equal(f.stockOutBeforeArrival, true);
});
