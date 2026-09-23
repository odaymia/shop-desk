import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SERVICE_INTERVALS, lastDoneMap, serviceStatus, serviceReview, reviewCounts, mergeMotorIntervals } from "../src/lib/serviceReview.js";

const now = Date.UTC(2026, 8, 23);
const day = 24 * 3600 * 1000;
const INT = [
  { id: "oil", name: "Engine oil & filter", miles: 5000, months: 6, match: "oil change | engine oil", price: 0 },
  { id: "coolant", name: "Coolant flush", miles: 60000, months: 60, match: "coolant flush | antifreeze", price: 130 },
  { id: "cabinAir", name: "Cabin air filter", miles: 30000, months: 24, match: "cabin air filter | cabin filter", price: 55 },
];

test("lastDoneMap finds the newest performed order per service", () => {
  const orders = {
    a: { id: "a", status: "invoiced", invoicedAt: now - 400 * day, mileageOut: 40000, lines: [{ kind: "labor", description: "Full oil change" }] },
    b: { id: "b", status: "invoiced", invoicedAt: now - 100 * day, mileageOut: 55000, lines: [{ kind: "labor", description: "Engine oil & filter" }, { kind: "labor", description: "Coolant flush service" }] },
    c: { id: "c", status: "estimate", invoicedAt: now - 1 * day, mileageOut: 60000, lines: [{ kind: "labor", description: "Cabin air filter" }] }, // not invoiced -> ignored
    self: { id: "self", status: "invoiced", invoicedAt: now, mileageOut: 60000, lines: [{ kind: "labor", description: "Oil change" }] },
  };
  const m = lastDoneMap(orders, INT, "self");
  assert.equal(m.oil.mileage, 55000); // order b is newer than a
  assert.equal(m.coolant.mileage, 55000);
  assert.equal(m.cabinAir, undefined); // only on an estimate -> not counted
});

test("serviceStatus: due by miles or months, soon at 80%, else done", () => {
  const oil = INT[0]; // 5000 mi / 6 mo
  assert.equal(serviceStatus(oil, { at: now - 30 * day, mileage: 50000 }, 56000, now), "due"); // 6000 mi since
  assert.equal(serviceStatus(oil, { at: now - 200 * day, mileage: 55000 }, 56000, now), "due"); // >6 months
  assert.equal(serviceStatus(oil, { at: now - 10 * day, mileage: 55000 }, 59200, now), "soon"); // 4200/5000 = 84%
  assert.equal(serviceStatus(oil, { at: now - 10 * day, mileage: 55000 }, 56000, now), "done"); // 1000 mi, fresh
});

test("serviceStatus: never done -> due if car is past the interval, else unknown", () => {
  const coolant = INT[1]; // 60000 mi
  assert.equal(serviceStatus(coolant, null, 70000, now), "due");
  assert.equal(serviceStatus(coolant, null, 20000, now), "unknown");
});

test("serviceReview: rows ordered due-first, with next-due mileage", () => {
  const orders = {
    b: { id: "b", status: "invoiced", invoicedAt: now - 20 * day, mileageOut: 55000, lines: [{ kind: "labor", description: "Engine oil change" }] },
  };
  const rows = serviceReview(INT, orders, 61000, "self", now);
  // oil last at 55000, now 61000 -> 6000 since -> due; coolant never, 61000>60000 -> due; cabinAir never, 61000>30000 -> due
  assert.equal(rows[0].status, "due");
  const oil = rows.find((r) => r.id === "oil");
  assert.equal(oil.status, "due");
  assert.equal(oil.nextDueMiles, 60000); // 55000 + 5000
  const c = reviewCounts(rows);
  assert.equal(c.due, 3);
});

test("mergeMotorIntervals overrides intervals from the factory schedule, prefers Replace over Inspect", () => {
  const motor = [
    { name: "Engine Oil & Filter Replace", miles: 7500, months: 12 },
    { name: "Cabin Air Filter Inspect", miles: 15000, months: 0 },
    { name: "Cabin Air Filter Replace", miles: 30000, months: 36 }, // preferred over the Inspect
    { name: "Cooling System Fluid Replace", miles: 100000, months: 120 },
  ];
  const { intervals, source, matched } = mergeMotorIntervals(DEFAULT_SERVICE_INTERVALS, motor);
  assert.equal(source, "MOTOR");
  assert.ok(matched >= 3);
  const oil = intervals.find((s) => s.id === "oil");
  assert.equal(oil.miles, 7500); // from MOTOR, not the 5000 generic
  assert.equal(oil.source, "MOTOR");
  const cabin = intervals.find((s) => s.id === "cabinAir");
  assert.equal(cabin.miles, 30000); // the Replace entry, not the 15000 Inspect
  const coolant = intervals.find((s) => s.id === "coolant");
  assert.equal(coolant.miles, 100000); // "Cooling System..." matched via motorKeys
  const trans = intervals.find((s) => s.id === "trans");
  assert.equal(trans.source, "generic"); // MOTOR didn't cover it -> generic kept
});

test("mergeMotorIntervals with no MOTOR data keeps generic", () => {
  const { source, intervals } = mergeMotorIntervals(DEFAULT_SERVICE_INTERVALS, []);
  assert.equal(source, "generic");
  assert.ok(intervals.every((s) => s.source === "generic"));
});

test("default interval table is well-formed", () => {
  assert.ok(DEFAULT_SERVICE_INTERVALS.length >= 10);
  assert.ok(DEFAULT_SERVICE_INTERVALS.every((s) => s.id && s.name && s.match && s.miles > 0));
});
