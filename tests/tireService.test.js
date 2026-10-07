import test from "node:test";
import assert from "node:assert/strict";
import { tireRotationsDue, isTireServiceOrder, isTireServiceLine } from "../src/lib/tireService.js";

const DAY = 86400000;
const now = Date.UTC(2026, 9, 1);
const svc = (vid, cust, daysAgo, lines) => ({
  id: `o-${vid}-${daysAgo}`,
  status: "invoiced",
  customerId: cust,
  vehicleId: vid,
  invoicedAt: now - daysAgo * DAY,
  lines,
});
const tireSale = (vid, cust, daysAgo) => svc(vid, cust, daysAgo, [{ kind: "part", tireSize: "225/50R17", description: "Hankook 225/50R17", qty: 4, price: 139 }]);
const rotation = (vid, cust, daysAgo) => svc(vid, cust, daysAgo, [{ kind: "labor", description: "Tire rotation & balance", hours: 0.5, rate: 25 }]);

test("isTireServiceLine / isTireServiceOrder", () => {
  assert.equal(isTireServiceLine({ kind: "part", tireSize: "225/50R17" }), true);
  assert.equal(isTireServiceLine({ kind: "labor", description: "Tire rotation" }), true);
  assert.equal(isTireServiceLine({ kind: "labor", description: "Oil change" }), false);
  assert.equal(isTireServiceOrder({ lines: [{ kind: "labor", description: "Mount & balance 4 tires" }] }), true);
});

test("tireRotationsDue: sorts into soon / overdue / lapsed, skips fleet", () => {
  const orders = {
    a: tireSale("v1", "c1", 210), // 7 mo ago at 6-mo interval → overdue (within lapse)
    b: rotation("v2", "c2", 160), // ~5.3 mo → due within 30 days → soon
    c: tireSale("v3", "c3", 600), // 20 mo → lapsed
    d: rotation("v4", "c4", 30), //  last month → ok
    f: tireSale("vF", "cf", 210), // fleet → excluded
  };
  const vehicles = {
    v1: { id: "v1", customerId: "c1", active: true },
    v2: { id: "v2", customerId: "c2", active: true },
    v3: { id: "v3", customerId: "c3", active: true },
    v4: { id: "v4", customerId: "c4", active: true },
    vF: { id: "vF", customerId: "cf", active: true },
  };
  const customers = { c1: {}, c2: {}, c3: {}, c4: {}, cf: { fleet: { discounts: {} } } };
  const r = tireRotationsDue({ orders, vehicles, customers, cfg: { tireRotationMonths: 6, tireRotationMiles: 5000 }, now });

  assert.deepEqual(r.overdue.map((x) => x.vehicleId), ["v1"]);
  assert.deepEqual(r.soon.map((x) => x.vehicleId), ["v2"]);
  assert.deepEqual(r.lapsed.map((x) => x.vehicleId), ["v3"]);
  assert.ok(!r.rows.some((x) => x.vehicleId === "vF"));
});

test("tireRotationsDue: keeps only the latest tire service per car", () => {
  const orders = { old: rotation("v1", "c1", 400), recent: rotation("v1", "c1", 20) };
  const r = tireRotationsDue({ orders, vehicles: { v1: { id: "v1", customerId: "c1", active: true } }, customers: { c1: {} }, cfg: { tireRotationMonths: 6 }, now });
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].status, "ok"); // 20 days ago → not due
});
