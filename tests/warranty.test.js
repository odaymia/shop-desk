import test from "node:test";
import assert from "node:assert/strict";
import { tireWarranties, warrantyStatus, roadHazardCredit, treadlifeCredit, hasRoadHazard, isTireLine } from "../src/lib/warranty.js";

const DAY = 86400000;
const now = Date.UTC(2026, 9, 1); // Oct 1, 2026

const order = (over) => ({
  id: "o1",
  number: 3001,
  status: "invoiced",
  customerId: "c1",
  vehicleId: "v1",
  invoicedAt: now - 30 * DAY,
  mileageIn: 40000,
  lines: [
    { id: "l1", kind: "part", tireSize: "225/50R17", description: "Michelin Defender2 225/50R17", qty: 4, price: 189, treadlifeMiles: 60000, dots: ["DOT1234"], warranty: undefined },
    { id: "l2", kind: "labor", description: "Mount, balance & disposal", hours: 4, rate: 25 },
    { id: "l3", kind: "fee", description: "Road hazard warranty", qty: 4, price: 28, warranty: "hazard" },
  ],
  ...over,
});

test("isTireLine / hasRoadHazard", () => {
  const o = order();
  assert.equal(isTireLine(o.lines[0]), true);
  assert.equal(isTireLine(o.lines[1]), false);
  assert.equal(hasRoadHazard(o), true);
  assert.equal(hasRoadHazard({ lines: [{ kind: "fee", description: "Nitrogen" }] }), false);
});

test("tireWarranties: one record per invoiced tire sale, with RH + tread-life", () => {
  const recs = tireWarranties({ orders: { o1: order(), o2: order({ id: "o2", number: 3002, status: "estimate" }) } });
  assert.equal(recs.length, 1); // the estimate is not a sale
  const r = recs[0];
  assert.equal(r.roadHazard, true);
  assert.equal(r.tireCount, 4);
  assert.equal(r.tires[0].treadlifeMiles, 60000);
  assert.deepEqual(r.tires[0].dots, ["DOT1234"]);
  assert.equal(r.mileage, 40000);
});

test("tireWarranties: skips merged and non-tire tickets", () => {
  const noTires = order({ id: "o3", number: 3003, lines: [{ id: "x", kind: "labor", description: "Rotate & balance", hours: 0.5, rate: 20 }] });
  const merged = order({ id: "o4", number: 3004, mergedInto: "o1" });
  const recs = tireWarranties({ orders: { o3: noTires, o4: merged } });
  assert.equal(recs.length, 0);
});

test("tireWarranties: a road-hazard sale with NO tire line still becomes a record", () => {
  // road hazard added as a plain fee line (no marker, no tire) — detected by description
  const standalone = order({ id: "o5", number: 3005, lines: [{ id: "l1", kind: "fee", description: "Road Hazard Warranty", qty: 4, price: 20 }] });
  const recs = tireWarranties({ orders: { o5: standalone } });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].roadHazard, true);
  assert.equal(recs[0].tires.length, 0); // no tire on the ticket
  assert.equal(recs[0].tireCount, 0);
  // and the status still reports active road-hazard coverage
  assert.equal(warrantyStatus(recs[0], { warranty: { roadHazardMonths: 36 } }, now).roadHazard.active, true);
});

test("warrantyStatus: road hazard active within term, expired after", () => {
  const r = tireWarranties({ orders: { o1: order() } })[0];
  const active = warrantyStatus(r, { warranty: { roadHazardMonths: 36 } }, now);
  assert.equal(active.roadHazard.sold, true);
  assert.equal(active.roadHazard.active, true);
  assert.equal(active.treadlife, true);
  // sold 60 days ago, 1-month term → well past expiry
  const old = tireWarranties({ orders: { o1: order({ invoicedAt: now - 60 * DAY }) } })[0];
  const expired = warrantyStatus(old, { warranty: { roadHazardMonths: 1 } }, now);
  assert.equal(expired.roadHazard.active, false);
});

test("roadHazardCredit: free first 25%, then prorated to the 2/32 floor", () => {
  const cfg = { warranty: { roadHazardMonths: 36, roadHazardBasis: "tread", newTread32: 10, freeWearPct: 25, floorTread32: 2 } };
  const soldAt = now - 30 * DAY;
  // new tire 10/32, usable 8, free until 8/32 remaining (first 2/32 of wear):
  assert.equal(roadHazardCredit({ tirePrice: 200, soldAt, now, cfg, remainingTread32: 10 }), 200); // brand new → free
  assert.equal(roadHazardCredit({ tirePrice: 200, soldAt, now, cfg, remainingTread32: 8 }), 200); // exactly 25% worn → still free
  // past the free window: prorate full@8/32 → 0@2/32. At 5/32: (5-2)/(8-2)=50% → $100
  assert.equal(roadHazardCredit({ tirePrice: 200, soldAt, now, cfg, remainingTread32: 5 }), 100);
  // at 4/32: (4-2)/6 = 33.3% → $66.67
  assert.equal(roadHazardCredit({ tirePrice: 200, soldAt, now, cfg, remainingTread32: 4 }), 66.67);
  // at or below the 2/32 floor → no warranty
  assert.equal(roadHazardCredit({ tirePrice: 200, soldAt, now, cfg, remainingTread32: 2 }), 0);
  assert.equal(roadHazardCredit({ tirePrice: 200, soldAt, now, cfg, remainingTread32: 1 }), 0);
  // past the 3-year time cap → no warranty even with tread left
  assert.equal(roadHazardCredit({ tirePrice: 200, soldAt: now - 40 * 30 * DAY, now, cfg, remainingTread32: 7 }), 0);
});

test("roadHazardCredit: time basis prorates by remaining months", () => {
  // bought today, full window remaining → ~full price
  const full = roadHazardCredit({ tirePrice: 100, soldAt: now, now, cfg: { warranty: { roadHazardMonths: 36, roadHazardBasis: "time" } } });
  assert.ok(full > 99.9 && full <= 100);
});

test("treadlifeCredit: share of rated miles not yet driven", () => {
  // 60k warranty, 15k driven → 75% of price left
  assert.equal(treadlifeCredit({ tirePrice: 200, warrantyMiles: 60000, milesUsed: 15000 }), 150);
  assert.equal(treadlifeCredit({ tirePrice: 200, warrantyMiles: 60000, milesUsed: 60000 }), 0);
  assert.equal(treadlifeCredit({ tirePrice: 200, warrantyMiles: 0, milesUsed: 1000 }), 0); // no tread-life warranty
});
