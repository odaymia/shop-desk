import { test } from "node:test";
import assert from "node:assert/strict";
import { carfaxRows, carfaxFile, carfaxFileName, splitAddress, CARFAX_FIELDS } from "../src/lib/carfax.js";

const cfg = { shopName: "Genie Auto Center", shopAddress: "4120 Adams Ave, San Diego, CA 92116", shopPhone: "(619) 555-0142", carfaxLocationId: "GAC1" };
const vehicle = { vin: "1HGCM82633A004352", make: "Honda", model: "Accord", year: 2003, plate: "8abc123", plateState: "CA", mileage: 148200 };
const order = {
  status: "invoiced", number: 4484, createdAt: Date.UTC(2026, 8, 5, 20), invoicedAt: Date.UTC(2026, 8, 5, 23), mileageIn: 81419,
  lines: [
    { kind: "labor", job: "Mount & Balance Tires", description: "Mount & balance" },
    { kind: "part", job: "Mount & Balance Tires", description: "Mastercraft Stratus 235/65R18", qty: 2, price: 144.31 },
    { kind: "fee", description: "CA tire fee", qty: 2, price: 1.75 },
    { kind: "discount", description: "Coupon", qty: 1, price: 10 },
  ],
};

test("address splits into street, city, state, zip", () => {
  assert.deepEqual(splitAddress("4120 Adams Ave, San Diego, CA 92116"), { address: "4120 Adams Ave", city: "San Diego", state: "CA", zip: "92116" });
  assert.equal(splitAddress("no commas here").city, "");
});

test("one row per labor or part line, fees and discounts left out, no prices or names", () => {
  const rows = carfaxRows(order, vehicle, cfg);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].VIN, "1HGCM82633A004352");
  assert.equal(rows[0].LABOR_DESCRIPTION, "Mount & balance");
  assert.equal(rows[0].PART_NAME_DESCRIPTION, "");
  assert.equal(rows[1].PART_NAME_DESCRIPTION, "Mastercraft Stratus 235/65R18");
  assert.equal(rows[1].PART_QUANTITY, "2");
  assert.equal(rows[0].MILEAGE, "81419");
  assert.equal(rows[0].PLATE, "8ABC123");
  assert.equal(rows[0].CITY, "San Diego");
  assert.equal(rows[0].PHONE, "6195550142");
  assert.equal(rows[0].MANAGEMENT_SYSTEM, "Shop Desk");
  assert.equal(rows[0].LOCATION_ID, "GAC1");
  assert.equal(Object.keys(rows[0]).length, CARFAX_FIELDS.length);
  assert.equal(JSON.stringify(rows).includes("144.31"), false);
});

test("estimates, voids, and cars without a VIN are skipped", () => {
  assert.equal(carfaxRows({ ...order, status: "estimate" }, vehicle, cfg).length, 0);
  assert.equal(carfaxRows(order, { ...vehicle, vin: "" }, cfg).length, 0);
});

test("file is quoted and pipe delimited with the header first", () => {
  const txt = carfaxFile(carfaxRows(order, vehicle, cfg));
  const lines = txt.trim().split("\n");
  assert.equal(lines[0].startsWith('"VIN"|"RO_OPEN_DATE"|'), true);
  assert.equal(lines.length, 3);
  assert.equal(lines[1].split("|").length, 24);
  assert.equal(carfaxFileName("Shop Desk", "PROD", new Date(2026, 8, 7)), "ShopDesk_PROD_RO_09072026.txt");
});
