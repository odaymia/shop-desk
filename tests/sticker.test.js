import { test } from "node:test";
import assert from "node:assert/strict";
import { hasOilChange, lastOilUsed, stickerData, currentMileage, reminderMonthsFor, reminderMilesFor } from "../src/lib/sticker.js";

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
  assert.equal(d.vehicleId, "8ABC123"); // plate, uppercased (no state on this vehicle)
  assert.equal(d.nextDate, "09/15/2026"); // Jun 15 + 3 months
  assert.equal(d.nextMileage, 64000); // 61000 + 3000
  assert.equal(d.lastOil, "Valvoline Full Synthetic 5W-30");
});

test("the vehicle id is the plate shown with its state, like CA - 8ABC123", () => {
  const d = stickerData(oilOrder, cfg, { ...vehicle, plateState: "ca" });
  assert.equal(d.vehicleId, "CA - 8ABC123");
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

test("currentMileage reads the ticket, then the car, else 0 (unknown)", () => {
  assert.equal(currentMileage({ mileageOut: 62000, mileageIn: 61000 }, { mileage: 5 }), 62000);
  assert.equal(currentMileage({ mileageIn: 61000 }, { mileage: 5 }), 61000);
  assert.equal(currentMileage({}, { mileage: 40000 }), 40000);
  assert.equal(currentMileage({}, {}), 0);
});

test("the reminder interval defaults to the car's own setting, then the shop's, then 3mo/3000mi", () => {
  assert.equal(reminderMonthsFor({ reminderMonths: 4 }, cfg), 4); // the car wins
  assert.equal(reminderMilesFor({ reminderMiles: 5000 }, cfg), 5000);
  assert.equal(reminderMonthsFor({}, cfg), 3); // then the shop
  assert.equal(reminderMilesFor({}, cfg), 3000);
  assert.equal(reminderMonthsFor(null, null), 3); // then the built-in default
  assert.equal(reminderMilesFor(null, null), 3000);
});

test("a car with its own remembered interval defaults the sticker to it", () => {
  const d = stickerData(oilOrder, cfg, { ...vehicle, reminderMonths: 4, reminderMiles: 5000 });
  assert.equal(d.months, 4);
  assert.equal(d.miles, 5000);
  assert.equal(d.nextDate, "10/15/2026"); // Jun 15 + 4 months
  assert.equal(d.nextMileage, 66000); // 61000 + 5000
});

test("opts override the defaults live, e.g. mileage typed in when the ticket had none", () => {
  const noMi = { ...oilOrder, mileageIn: 0 };
  const d = stickerData(noMi, cfg, { year: "2019", make: "Honda", model: "Accord" }, { mileage: 88000, months: 6, miles: 5000 });
  assert.equal(d.mileage, 88000);
  assert.equal(d.nextMileage, 93000);
  assert.equal(d.nextDate, "12/15/2026");
});
