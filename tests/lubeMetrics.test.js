import test from "node:test";
import assert from "node:assert/strict";
import { throughput } from "../src/lib/lubeMetrics.js";

const visits = [
  { vehicleId: "a", at: Date.UTC(2026, 5, 10, 15), total: 100 }, // Jun 10
  { vehicleId: "b", at: Date.UTC(2026, 5, 10, 16), total: 60 }, //  Jun 10 (same day)
  { vehicleId: "a", at: Date.UTC(2026, 5, 20, 15), total: 80 }, //  Jun 20 (same car again)
  { vehicleId: "c", at: Date.UTC(2026, 6, 10, 15), total: 120 }, // Jul 10
];
const FROM = Date.UTC(2026, 0, 1);
const TO = Date.UTC(2026, 11, 31);

test("throughput: cars, tickets, open days, per-day, and month breakdown", () => {
  const t = throughput(visits, FROM, TO);
  assert.equal(t.tickets, 4);
  assert.equal(t.cars, 3); // a, b, c (a counted once)
  assert.equal(t.revenue, 360);
  assert.equal(t.openDays, 3); // Jun 10, Jun 20, Jul 10
  assert.equal(t.perDay, 1.33); // 4 / 3
  assert.ok(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].includes(t.busiestDay));
  assert.equal(t.months.length, 2);
  assert.equal(t.months[0].month, "2026-07"); // newest first
  assert.equal(t.months[1].month, "2026-06");
  assert.equal(t.months[1].cars, 2); // a, b in June
  assert.equal(t.months[1].revenue, 240);
});

test("throughput: empty range is zeroed, not divide-by-zero", () => {
  const t = throughput(visits, Date.UTC(2020, 0, 1), Date.UTC(2020, 11, 31));
  assert.equal(t.tickets, 0);
  assert.equal(t.perDay, 0);
  assert.equal(t.busiestDay, "—");
  assert.equal(t.months.length, 0);
});
