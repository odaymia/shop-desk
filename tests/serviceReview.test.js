import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SERVICE_INTERVALS, lastDoneMap, serviceStatus, serviceReview, reviewCounts } from "../src/lib/serviceReview.js";

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

test("default interval table is well-formed", () => {
  assert.ok(DEFAULT_SERVICE_INTERVALS.length >= 10);
  assert.ok(DEFAULT_SERVICE_INTERVALS.every((s) => s.id && s.name && s.match && s.miles > 0));
});
