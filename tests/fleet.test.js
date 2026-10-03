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

import { moveVehicleToFleet } from "../src/lib/fleet.js";
import { orderTotals } from "../src/lib/invoice.js";

test("moving a car onto a fleet keeps past invoices' totals", () => {
  const cfg = { taxRate: 10 };
  const fleet = { id: "f1", taxExempt: true, fleet: { discounts: { oil: 10 } } };
  const was = { id: "c1" };
  const vehicle = { id: "v1", customerId: "c1" };
  const inv = { id: "o1", vehicleId: "v1", customerId: "c1", status: "invoiced", lines: [{ kind: "part", desc: "Filter", qty: 1, price: 100, taxable: true }] };
  const other = { id: "o2", vehicleId: "v2", customerId: "c1", status: "invoiced", lines: [] };
  const off = moveVehicleToFleet({ vehicle, orders: [inv, other], fleet, fromCustomer: was, cfg, moveHistory: false });
  assert.equal(off.vehicle.customerId, "f1");
  assert.equal(off.orders.length, 0);
  const on = moveVehicleToFleet({ vehicle, orders: [inv, other], fleet, fromCustomer: was, cfg, moveHistory: true });
  assert.deepEqual(on.orders.map((o) => o.id), ["o1"]);
  const before = orderTotals(inv, cfg, was).total;
  assert.equal(orderTotals(on.orders[0], cfg, fleet).total, before);
  assert.equal(on.orders[0].movedFrom, "c1");
});

import { fleetReport } from "../src/lib/fleet.js";
test("fleetReport rolls up fleet accounts over a range, excluding retail customers", () => {
  const customers = {
    c1: { id: "c1", company: "Front Range Plumbing", fleet: { discounts: { oil: 10 } } },
    c2: { id: "c2", first: "Joe", last: "Retail" }, // not a fleet
  };
  const orders = {
    o1: { id: "o1", status: "invoiced", customerId: "c1", invoicedAt: 200, lines: [{ kind: "labor", oil: true, job: "Oil", hours: 1, rate: 50 }], payments: [{ method: "account", amount: 30, at: 200 }] },
    o2: { id: "o2", status: "invoiced", customerId: "c1", invoicedAt: 50, lines: [{ kind: "labor", oil: true, job: "Oil", hours: 1, rate: 40 }], payments: [] }, // out of range
    o3: { id: "o3", status: "invoiced", customerId: "c2", invoicedAt: 200, lines: [{ kind: "labor", job: "Oil", hours: 1, rate: 99 }], payments: [] }, // retail
  };
  const r = fleetReport(orders, customers, {}, {}, 100, 300);
  assert.equal(r.accounts, 1); // only c1 is a fleet
  assert.equal(r.activeAccounts, 1);
  assert.equal(r.tickets, 1); // only o1 is in range
  assert.equal(r.revenue, 50);
  assert.equal(r.onAccount, 30);
  assert.equal(r.outstanding, 60); // o1 balance 20 + o2 balance 40 (all-time)
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].id, "c1");
  assert.equal(r.rows[0].balance, 60);
});
