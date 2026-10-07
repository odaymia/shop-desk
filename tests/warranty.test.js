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

test("roadHazardCredit: tread basis prorates by remaining tread", () => {
  // half the tread left on a $189 tire → ~$94.50
  const c = roadHazardCredit({ tirePrice: 189, soldAt: now - 30 * DAY, now, cfg: { warranty: { roadHazardMonths: 36, roadHazardBasis: "tread", newTread32: 10 } }, remainingTread32: 5 });
  assert.equal(c, 94.5);
  // bald tire → nothing left to credit
  assert.equal(roadHazardCredit({ tirePrice: 189, soldAt: now - 30 * DAY, now, cfg: { warranty: { roadHazardBasis: "tread", newTread32: 10 } }, remainingTread32: 0 }), 0);
  // out of the coverage window → 0
  assert.equal(roadHazardCredit({ tirePrice: 189, soldAt: now - 40 * 30 * DAY, now, cfg: { warranty: { roadHazardMonths: 36, roadHazardBasis: "tread" } }, remainingTread32: 8 }), 0);
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
