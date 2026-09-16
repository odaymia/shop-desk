import { test } from "node:test";
import assert from "node:assert/strict";
import { hasOilChange, lastOilUsed, stickerData } from "../src/lib/sticker.js";

const oilOrder = {
  invoicedAt: new Date(2026, 5, 15).getTime(), // Jun 15 2026
  mileageIn: 61000,
  lines: [
    { kind: "labor", packaged: true, job: "Valvoline Full Synthetic Oil Change", description: "Valvoline Full Synthetic Oil Change" },
    { kind: "part", packaged: true, qty: 5, description: "Valvoline Full Synthetic 5W-30", job: "Valvoline Full Synthetic Oil Change" },
    { kind: "part", packaged: true, qty: 1, description: "Oil filter (included)", job: "Valvoline Full Synthetic Oil Change" },
  ],
};
const cfg = { reminderMonths: 3, reminderMiles: 3000 };
const vehicle = { year: "2019", make: "Honda", model: "Accord", plate: "8abc123", vin: "1HGCV1F30KA000000" };

test("hasOilChange detects a packaged ticket", () => {
  assert.equal(hasOilChange(oilOrder), true);
  assert.equal(hasOilChange({ lines: [{ kind: "labor", description: "Diagnostic" }] }), false);
});

test("lastOilUsed picks the oil (most quarts), not the filter, and strips '(included)'", () => {
  assert.equal(lastOilUsed(oilOrder), "Valvoline Full Synthetic 5W-30");
});

test("stickerData computes next date and mileage from the interval", () => {
  const d = stickerData(oilOrder, cfg, vehicle);
  assert.equal(d.vehicleId, "8ABC123"); // plate, uppercased
  assert.equal(d.nextDate, "09/15/2026"); // Jun 15 + 3 months
  assert.equal(d.nextMileage, 64000); // 61000 + 3000
  assert.equal(d.lastOil, "Valvoline Full Synthetic 5W-30");
});

test("stickerData falls back to the vehicle name when there's no plate, and blanks mileage when unknown", () => {
  const d = stickerData({ ...oilOrder, mileageIn: 0 }, cfg, { year: "2019", make: "Honda", model: "Accord" });
  assert.equal(d.vehicleId, "2019 Honda Accord");
  assert.equal(d.nextMileage, null);
});

test("a longer interval pushes the date and mileage out", () => {
  const d = stickerData(oilOrder, { reminderMonths: 6, reminderMiles: 7500 }, vehicle);
  assert.equal(d.nextDate, "12/15/2026");
  assert.equal(d.nextMileage, 68500);
});
