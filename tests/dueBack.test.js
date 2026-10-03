import test from "node:test";
import assert from "node:assert/strict";
import { dueBack } from "../src/lib/dueBack.js";

const DAY = 86400000;
const now = Date.UTC(2026, 6, 1); // Jul 1, 2026
const oil = (vid, cust, daysAgo) => ({
  id: `o-${vid}`,
  status: "invoiced",
  customerId: cust,
  vehicleId: vid,
  invoicedAt: now - daysAgo * DAY,
  lines: [{ kind: "labor", oil: true, description: "Oil change" }],
});

test("dueBack: sorts cars into due-soon, overdue (winnable) and lapsed, skips fleet", () => {
  const orders = {
    o1: oil("v1", "c1", 122), // ~4 mo ago → past a 3-mo interval, seen recently → overdue
    o2: oil("v2", "c2", 88), //  just under 3 mo → due within 30 days → soon
    o3: oil("v3", "c3", 730), // 2 years ago → lapsed
    o4: oil("v4", "c4", 30), //  last month → not due yet → ok
    oF: oil("vF", "cf", 122), // fleet account → excluded
  };
  const vehicles = {
    v1: { id: "v1", customerId: "c1", active: true },
    v2: { id: "v2", customerId: "c2", active: true },
    v3: { id: "v3", customerId: "c3", active: true },
    v4: { id: "v4", customerId: "c4", active: true },
    vF: { id: "vF", customerId: "cf", active: true },
  };
  const customers = { c1: {}, c2: {}, c3: {}, c4: {}, cf: { fleet: { discounts: {} } } };
  const r = dueBack({ orders, vehicles, customers, parts: {}, cfg: { reminderMonths: 3, reminderMiles: 3000 }, now });

  assert.deepEqual(r.overdue.map((x) => x.vehicleId), ["v1"]);
  assert.deepEqual(r.soon.map((x) => x.vehicleId), ["v2"]);
  assert.deepEqual(r.lapsed.map((x) => x.vehicleId), ["v3"]);
  assert.ok(!r.rows.some((x) => x.vehicleId === "vF")); // fleet excluded
  assert.ok(r.overdue[0].dueDays > 0); // actually past due
});

test("dueBack: a car's own saved reminder interval wins over the shop default", () => {
  const orders = { o1: oil("v1", "c1", 200) }; // 200 days ago
  const vehicles = { v1: { id: "v1", customerId: "c1", active: true, reminderMonths: 12 } }; // yearly
  const r = dueBack({ orders, vehicles, customers: { c1: {} }, parts: {}, cfg: { reminderMonths: 3 }, now });
  // at a 12-month interval, 200 days is not due yet
  assert.equal(r.overdue.length, 0);
  assert.equal(r.rows[0].status, "ok");
});
