import { test } from "node:test";
import assert from "node:assert/strict";
import { isFleet, lineFleetCategory, fleetDiscountAmounts, fleetDiscountLine, fleetStats } from "../src/lib/fleet.js";

const fleetCust = { id: "c1", company: "Front Range Plumbing", fleet: { discounts: { oil: 10, tires: 15, mechanical: 5 } } };

const order = {
  customerId: "c1",
  lines: [
    { kind: "labor", oil: true, job: "Oil change", description: "Full oil change", hours: 1, rate: 40 },
    { kind: "part", oil: true, job: "Oil change", description: "Motor oil", qty: 5, price: 6, condition: "new" },
    { kind: "part", job: "Tire replacement", description: "Tire 225/65R17", qty: 4, price: 120, condition: "new" },
    { kind: "labor", job: "Front brake pads replacement", description: "Replace pads", hours: 2, rate: 100 },
    { kind: "part", job: "Front brake pads replacement", number: "BP-1", description: "Brake pads", qty: 1, price: 60, condition: "new" },
  ],
};

test("isFleet detects the fleet flag", () => {
  assert.ok(isFleet(fleetCust));
  assert.ok(!isFleet({ company: "Acme" }));
  assert.ok(!isFleet(null));
});

test("lineFleetCategory sorts lines into oil / tires / mechanical", () => {
  assert.equal(lineFleetCategory(order.lines[0], {}), "oil");
  assert.equal(lineFleetCategory(order.lines[2], {}), "tires");
  assert.equal(lineFleetCategory(order.lines[3], {}), "mechanical");
  assert.equal(lineFleetCategory({ kind: "note" }, {}), null);
  assert.equal(lineFleetCategory({ kind: "fee", description: "shop" }, {}), null);
});

test("fleetDiscountAmounts discounts each bucket at its percentage", () => {
  const a = fleetDiscountAmounts(order, fleetCust, {});
  // oil: (40 + 30) * 10% = 7.00 ; tires: 480 * 15% = 72.00 ; mechanical: (200 + 60) * 5% = 13.00
  assert.equal(a.oil, 7);
  assert.equal(a.tires, 72);
  assert.equal(a.mechanical, 13);
});

test("fleetDiscountLine totals the buckets and describes the rates", () => {
  const l = fleetDiscountLine(order, fleetCust, {});
  assert.equal(l.price, 92); // 7 + 72 + 13
  assert.match(l.description, /Fleet discount — oil 10%, tires 15%, labor 5%/);
  assert.equal(fleetDiscountLine(order, { company: "no fleet" }, {}), null);
  assert.equal(fleetDiscountLine({ lines: [] }, fleetCust, {}), null); // nothing to discount
});

test("fleetStats rolls up invoiced totals, categories, and on-account balance", () => {
  const orders = [
    { id: "o1", status: "invoiced", customerId: "c1", invoicedAt: 200, lines: order.lines, payments: [{ method: "account", amount: 500 }] },
    { id: "o2", status: "invoiced", customerId: "c1", invoicedAt: 100, lines: [{ kind: "labor", oil: true, job: "Oil change", description: "Oil", hours: 1, rate: 50 }], payments: [] },
    { id: "o3", status: "estimate", customerId: "c1", lines: [] }, // not invoiced
    { id: "o4", status: "invoiced", customerId: "other", lines: [] }, // another customer
  ];
  const s = fleetStats(orders, fleetCust, {}, {});
  assert.equal(s.visits, 2);
  assert.equal(s.last, 200);
  assert.equal(s.onAccount, 500);
  assert.equal(s.byCat.tires, 480); // from o1
});
