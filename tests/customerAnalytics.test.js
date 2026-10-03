import test from "node:test";
import assert from "node:assert/strict";
import { customerStats, oilIntervals, customerLtv, vehicleLtv } from "../src/lib/customerAnalytics.js";

const DAY = 86400000;
const t = (d) => Date.UTC(2026, 0, 1) + d * DAY; // day 0 = 2026-01-01

// A: new in period, returned (2 visits) · B: new in period, not returned
// C: acquired before the period, back during it (returning) · D: outside the period
const visits = [
  { customerId: "A", vehicleId: "VA", at: t(12), total: 100, miles: 20000, isOil: true },
  { customerId: "A", vehicleId: "VA", at: t(50), total: 200, miles: 24000, isOil: true },
  { customerId: "B", vehicleId: "VB", at: t(20), total: 60, miles: 10000, isOil: true },
  { customerId: "C", vehicleId: "VC", at: t(5), total: 80, miles: 5000, isOil: false },
  { customerId: "C", vehicleId: "VC", at: t(30), total: 120, miles: 9000, isOil: false },
  { customerId: "D", vehicleId: "VD", at: t(100), total: 50, miles: 3000, isOil: true },
];
const FROM = t(10);
const TO = t(40);

test("customerStats: new, returned, returning, active, average ticket", () => {
  const s = customerStats(visits, FROM, TO);
  assert.equal(s.newCount, 2); // A, B first-seen in window
  assert.equal(s.newReturned, 1); // A came back
  assert.equal(s.newReturnRate, 50);
  assert.equal(s.returningCount, 1); // C, acquired before, active now
  assert.equal(s.activeCount, 3); // A, B, C had a visit in the window
  assert.equal(s.periodVisits, 3); // A@12, B@20, C@30 (A@50 and D@100 are out)
  assert.equal(s.avgTicket, 93.33); // (100+60+120)/3
  assert.equal(s.newCustomers[0].customerId, "B"); // newest first (day 20)
});

test("oilIntervals: average days and miles between oil changes, bad gaps dropped", () => {
  const v = [
    { customerId: "x", vehicleId: "V1", at: t(0), total: 50, miles: 10000, isOil: true },
    { customerId: "x", vehicleId: "V1", at: t(180), total: 50, miles: 15000, isOil: true }, // +180d +5000mi (both valid)
    { customerId: "x", vehicleId: "V1", at: t(400), total: 50, miles: 100000, isOil: true }, // +220d (valid) +85000mi (dropped)
    { customerId: "x", vehicleId: "V1", at: t(410), total: 50, miles: 15100, isOil: false }, // not an oil change
  ];
  const o = oilIntervals(v);
  assert.equal(o.avgDays, 200); // (180 + 220) / 2
  assert.equal(o.avgMiles, 5000); // only the 5000 gap counts
  assert.equal(o.dayCount, 2);
  assert.equal(o.mileCount, 1);
});

test("oilIntervals: range filters by the later visit", () => {
  const v = [
    { customerId: "x", vehicleId: "V1", at: t(0), miles: 10000, isOil: true },
    { customerId: "x", vehicleId: "V1", at: t(120), miles: 14000, isOil: true }, // later visit day 120
  ];
  assert.equal(oilIntervals(v, t(100), t(200)).dayCount, 1); // later visit in range
  assert.equal(oilIntervals(v, t(0), t(50)).dayCount, 0); // later visit out of range
});

test("customerLtv: average and median spend, visits, rows sorted by spend (all time)", () => {
  const l = customerLtv(visits);
  assert.equal(l.customers, 4);
  assert.equal(l.ltv, 152.5); // (300 + 60 + 200 + 50) / 4
  assert.equal(l.medianLtv, 130); // middle of [50, 60, 200, 300]
  assert.equal(l.avgVisits, 1.5); // (2 + 1 + 2 + 1) / 4
  assert.equal(l.rows[0].customerId, "A"); // biggest spender
  assert.equal(l.rows[0].revenue, 300);
});

test("customerLtv: a range scopes to customers active then, but still counts their whole history", () => {
  const l = customerLtv(visits, FROM, TO); // A, B, C active in window; D is not
  assert.equal(l.customers, 3); // D excluded
  assert.equal(l.ltv, 186.67); // (300 + 60 + 200) / 3 — A's day-50 visit still counts
  assert.equal(l.medianLtv, 200); // middle of [60, 200, 300]
  assert.equal(l.avgVisits, 1.67); // (2 + 1 + 2) / 3
  assert.ok(!l.rows.some((r) => r.customerId === "D"));
});

test("vehicleLtv: lifetime value grouped by car", () => {
  const l = vehicleLtv(visits);
  assert.equal(l.vehicles, 4);
  assert.equal(l.ltv, 152.5); // (300 + 60 + 200 + 50) / 4
  assert.equal(l.rows[0].vehicleId, "VA"); // VA spent the most (300)
  assert.equal(l.rows[0].revenue, 300);
  // range scopes to cars active in the window (VD is out)
  assert.equal(vehicleLtv(visits, FROM, TO).vehicles, 3);
});
