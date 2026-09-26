import { test } from "node:test";
import assert from "node:assert/strict";
import { lineDept, orderDepts, deptAmount, isMaintenanceOnly, authorizationRequired, combinable, mergeTickets, activeDepts } from "../src/lib/departments.js";
import { complianceWarnings } from "../src/lib/compliance.js";

const L = (job, description, price = 10, kind = "labor") => ({ kind, job, description, qty: 1, price, hours: 1, rate: price });
const oil = L("Oil change", "Oil change up to 5 qt", 60);
const filter = L("Oil change", "Engine oil filter", 0, "part");
const tires = L("Tires", "Mount and balance 4 tires", 80);
const rotate = L("", "Tire rotation", 20);
const brakes = L("Front brakes", "Front brake pads", 180);
const wipers = L("", "Wiper blades", 25, "part");

test("each line lands in a department; notes and fees don't", () => {
  assert.equal(lineDept(oil), "oil");
  assert.equal(lineDept(filter), "oil");
  assert.equal(lineDept(wipers), "oil");
  assert.equal(lineDept(tires), "tires");
  assert.equal(lineDept(brakes), "mech");
  assert.equal(lineDept(L("", "Diagnose check engine light")), "mech");
  assert.equal(lineDept({ kind: "note", description: "oil change" }), null);
  assert.equal(lineDept({ kind: "fee", description: "Shop supplies" }), null);
});

test("a ticket belongs to every department its work touches, plus where it started", () => {
  assert.deepEqual(orderDepts({ lines: [] }), ["mech"]);
  assert.deepEqual(orderDepts({ dept: "tires", lines: [] }), ["tires"]);
  assert.deepEqual(orderDepts({ dept: "oil", lines: [oil, filter] }), ["oil"]);
  assert.deepEqual(orderDepts({ dept: "oil", lines: [tires, oil] }), ["oil", "tires"]);
  assert.equal(deptAmount({ lines: [oil, tires, brakes] }, "tires"), 80);
});

test("the shop can turn departments off", () => {
  assert.deepEqual(activeDepts({}).map((d) => d.id), ["oil", "tires", "mech"]);
  assert.deepEqual(activeDepts({ departments: { oil: false, mech: false } }).map((d) => d.id), ["tires"]);
});

test("oil changes, fluids, wipers and rotations are maintenance; brakes and new tires aren't", () => {
  assert.equal(isMaintenanceOnly({ lines: [oil, filter, wipers, rotate, { kind: "fee", description: "Hazardous waste" }] }), true);
  assert.equal(isMaintenanceOnly({ lines: [oil, brakes] }), false);
  assert.equal(isMaintenanceOnly({ lines: [oil, tires] }), false);
  assert.equal(isMaintenanceOnly({ lines: [L("", "Brake fluid flush")] }), false);
  assert.equal(isMaintenanceOnly({ lines: [] }), false);
});

test("maintenance-only tickets skip the authorization warning unless the shop requires it", () => {
  const pm = { lines: [oil, filter] };
  assert.equal(authorizationRequired(pm, {}), false);
  assert.equal(authorizationRequired(pm, { pmSignature: "required" }), true);
  assert.equal(authorizationRequired({ lines: [brakes] }, {}), true);
  assert.equal(complianceWarnings(pm, {}, 60).length, 0);
  assert.equal(complianceWarnings(pm, { pmSignature: "required" }, 60).length, 1);
  assert.equal(complianceWarnings({ lines: [brakes] }, {}, 180).length, 1);
});

test("two open tickets for one car combine onto one receipt", () => {
  const a = { id: "a", number: 101, status: "open", vehicleId: "v1", customerId: "c1", dept: "oil", lines: [oil], payments: [], mileageIn: "84000", pitTechId: "p1", concern: "Oil change" };
  const b = { id: "b", number: 102, status: "estimate", vehicleId: "v1", customerId: "c1", dept: "tires", lines: [tires], payments: [{ id: "p", amount: 20 }], mileageIn: "84010", topTechId: "t1", concern: "Two new tires" };
  const c = { id: "c", number: 103, status: "invoiced", vehicleId: "v1", lines: [] };
  const d = { id: "d", number: 104, status: "open", vehicleId: "v2", lines: [] };
  assert.deepEqual(combinable(a, { a, b, c, d }).map((o) => o.id), ["b"]);
  const { into, from } = mergeTickets(a, b, 5);
  assert.deepEqual(into.lines, [oil, tires]);
  assert.equal(into.payments.length, 1);
  assert.equal(into.mileageIn, "84010");
  assert.equal(into.pitTechId, "p1");
  assert.equal(into.topTechId, "t1");
  assert.equal(into.concern, "Oil change\nTwo new tires");
  assert.deepEqual(orderDepts(into), ["oil", "tires"]);
  assert.equal(from.status, "deleted");
  assert.equal(from.mergedInto, "a");
  assert.equal(from.lines.length, 0);
});

test("quick-lube shorthand from real tickets", () => {
  assert.equal(lineDept(L("", "2PT FUEL INJECT SERVICE")), "oil");
  assert.equal(lineDept(L("", "VPS PWR STEERING SERVICE")), "oil");
  assert.equal(lineDept(L("", "REMOVE & REPLACE TPMS SENSOR")), "tires");
  assert.equal(lineDept(L("", "DISPOSAL FEE", 5, "part")), null);
  assert.equal(isMaintenanceOnly({ lines: [oil, L("", "2PT FUEL INJECT SERVICE"), L("", "DISPOSAL FEE", 5, "part")] }), true);
});

import { isQuickLube, lubeMenu, startStatus } from "../src/lib/departments.js";

test("quick lube: oil-only tickets, no estimate, lube menu only", () => {
  assert.equal(isQuickLube({ dept: "oil", lines: [] }), true);
  assert.equal(isQuickLube({ lines: [oil, filter, wipers] }), true);
  assert.equal(isQuickLube({ dept: "oil", lines: [oil, brakes] }), false);
  assert.equal(isQuickLube({ dept: "oil", lines: [oil] }, null, { quickLube: false }), false);
  assert.equal(isQuickLube({ lines: [] }), false);
  const menu = ["Oil change", "Brakes", "Tires", "Air filters", "Cabin air filters", "Wipers", "Transmission", "Radiator", "Brake fluid", "Fuel system", "Power steering", "Differential fluid"].map((name) => ({ id: name, name }));
  assert.deepEqual(lubeMenu(menu).map((m) => m.name), ["Oil change", "Air filters", "Cabin air filters", "Wipers", "Transmission", "Radiator", "Brake fluid", "Fuel system", "Power steering", "Differential fluid"]);
  assert.equal(startStatus("oil", {}), "open");
  assert.equal(startStatus("oil", { quickLube: false }), "estimate");
  assert.equal(startStatus("tires", {}), "estimate");
  assert.equal(startStatus(null, {}), "estimate");
});
