import test from "node:test";
import assert from "node:assert/strict";
import {
  validVin,
  carfaxCfg,
  SERVICE_FIELDS,
  serviceRows,
  serviceFileText,
  LOYALTY_FIELDS,
  loyaltyRows,
  loyaltyFileText,
  serviceFileName,
  loyaltyFileName,
} from "../src/lib/carfaxExport.js";

const CFG = {
  shopName: "Genie Auto Center",
  shopPhone: "(619) 971-1418",
  shopWebsite: "genieauto.com",
  carfax: { managementSystem: "Bolt Badger", locationId: "BOLTBADGER0001", providerId: "2743", address: "830 N 2nd St", city: "El Cajon", state: "CA", zip: "92021" },
};
const VEHICLES = {
  v1: { vin: "1HGCM82633A004352", make: "Honda", model: "Accord", year: 2019, plate: "8ABC123", plateState: "CA" },
  v2: { vin: "bad", make: "Ford", model: "F-150", year: 2020, plate: "9XYZ", plateState: "CA" }, // invalid VIN
};
const CUSTOMERS = {
  c1: { first: "Maria", last: "Alvarez", email: "maria@example.com", phone: "619-555-0111", zip: "92021", marketingOptIn: true },
  c2: { first: "Sam", last: "Lee", phone: "619-555-0222", zip: "92020" },
};
const now = Date.UTC(2026, 8, 22); // Sep 22, 2026
const day = 24 * 3600 * 1000;
const ORDERS = {
  o1: {
    number: "2041", status: "invoiced", customerId: "c1", vehicleId: "v1",
    createdAt: Date.UTC(2026, 8, 18), invoicedAt: Date.UTC(2026, 8, 18), mileageOut: 79262.4,
    lines: [
      { kind: "labor", description: "Oil change", qty: 1 },
      { kind: "part", description: "Engine oil filter", qty: 1 },
      { kind: "fee", description: "Shop supplies" }, // excluded
      { kind: "note", description: "Customer waited" }, // excluded
    ],
  },
  o2: { number: "2042", status: "invoiced", customerId: "c2", vehicleId: "v2", invoicedAt: Date.UTC(2026, 8, 19), lines: [{ kind: "labor", description: "Brake job" }] }, // skipped: bad VIN
  o3: { number: "2000", status: "estimate", customerId: "c1", vehicleId: "v1", createdAt: now, lines: [{ kind: "labor", description: "Quote" }] }, // skipped: not invoiced
};

test("validVin requires 17 clean characters", () => {
  assert.equal(validVin("1HGCM82633A004352"), true);
  assert.equal(validVin("1hg cm82633a004352"), true); // spaces/case cleaned
  assert.equal(validVin("bad"), false);
  assert.equal(validVin(""), false);
});

test("carfaxCfg defaults management system and falls back to shop info", () => {
  const cf = carfaxCfg(CFG);
  assert.equal(cf.managementSystem, "BOLT BADGER");
  assert.equal(cf.phone, "(619) 971-1418");
  assert.equal(cf.url, "genieauto.com");
  assert.equal(carfaxCfg({}).managementSystem, "BOLT BADGER");
});

test("serviceRows: invoiced + valid VIN only, one row per performed line", () => {
  const { rows, skippedNoVin, usedOrders } = serviceRows(ORDERS, VEHICLES, CFG);
  assert.equal(usedOrders, 1); // only o1
  assert.equal(skippedNoVin, 1); // o2 bad VIN (o3 excluded before VIN check: not invoiced)
  assert.equal(rows.length, 2); // labor + part (fee/note excluded)
  const r = rows[0];
  assert.equal(r.VIN, "1HGCM82633A004352");
  assert.equal(r.RO_INVOICE_NUMBER, "2041");
  assert.equal(r.ODOMETER_MEASURE, "MI");
  assert.equal(r.MILEAGE, 79262); // rounded
  assert.equal(r.SERVICE_DESCRIPTION, "Oil change");
  assert.equal(r.LABOR_DESCRIPTION, "Oil change");
  assert.equal(r.PART_NAME_DESCRIPTION, ""); // labor row has no part name
  assert.equal(r.MANAGEMENT_SYSTEM, "BOLT BADGER");
  assert.equal(r.PHONE, "619-971-1418");
  const part = rows[1];
  assert.equal(part.PART_NAME_DESCRIPTION, "Engine oil filter");
  assert.equal(part.PART_QUANTITY, 1);
  assert.equal(part.LABOR_DESCRIPTION, "");
});

test("serviceRows recentRecords: newest whole tickets totaling at least N", () => {
  const veh = { v: { vin: "1HGCM82633A004352", make: "Honda", model: "Accord", year: 2019 } };
  const mk = (n, ts, nlines) => ({ number: String(n), status: "invoiced", vehicleId: "v", invoicedAt: ts, lines: Array.from({ length: nlines }, (_, i) => ({ kind: "part", description: "P" + i, qty: 1 })) });
  const ords = { a: mk(1, 100, 2), b: mk(2, 200, 2), c: mk(3, 300, 2) }; // 3 tickets x 2 rows = 6
  const r = serviceRows(ords, veh, {}, { recentRecords: 3 });
  // newest tickets c(2)+b(2)=4 >= 3; a excluded. No RO split.
  assert.equal(r.usedOrders, 2);
  assert.equal(r.rows.length, 4);
  // returned chronologically: b (200) before c (300)
  assert.equal(r.rows[0].RO_INVOICE_NUMBER, "2");
  assert.equal(r.rows[3].RO_INVOICE_NUMBER, "3");
  // asking for more than exist just returns everything
  assert.equal(serviceRows(ords, veh, {}, { recentRecords: 999 }).rows.length, 6);
});

test("serviceFileText: pipe-delimited, quoted, header first, CRLF", () => {
  const { rows } = serviceRows(ORDERS, VEHICLES, CFG);
  const text = serviceFileText(rows);
  const lines = text.split("\r\n").filter(Boolean);
  assert.equal(lines[0], SERVICE_FIELDS.map((f) => `"${f}"`).join("|"));
  assert.ok(lines[1].startsWith('"1HGCM82633A004352"|'));
  assert.equal(lines.length, 3); // header + 2 rows
  assert.ok(!lines[1].includes("\n"));
});

test("loyaltyRows: one per invoiced service in window, opt-in flags", () => {
  const { rows, skippedNoVin } = loyaltyRows(ORDERS, CUSTOMERS, VEHICLES, CFG, { now });
  assert.equal(rows.length, 1); // o1 only (o2 bad VIN, o3 estimate)
  assert.equal(skippedNoVin, 1);
  const r = rows[0];
  assert.equal(r.Operation_Type, "Service");
  assert.equal(r.Operation_Sale_Type, "");
  assert.equal(r.Email, "maria@example.com");
  assert.equal(r.Email_Opt_In, "Yes"); // marketingOptIn true
  assert.equal(r.CellPhone, "6195550111");
  assert.equal(r.Provider_ID, "2743");
  assert.equal(r.Location_ID, "BOLTBADGER0001");
});

test("loyaltyRows: 24-month archive window excludes older", () => {
  const old = { oX: { number: "1000", status: "invoiced", customerId: "c1", vehicleId: "v1", invoicedAt: now - 800 * day, lines: [{ kind: "labor", description: "Old" }] } };
  const { rows } = loyaltyRows(old, CUSTOMERS, VEHICLES, CFG, { now });
  assert.equal(rows.length, 0); // 800 days > 24 months
});

test("loyaltyFileText: comma-delimited quoted CSV with header", () => {
  const { rows } = loyaltyRows(ORDERS, CUSTOMERS, VEHICLES, CFG, { now });
  const lines = loyaltyFileText(rows).split("\r\n").filter(Boolean);
  assert.equal(lines[0], LOYALTY_FIELDS.map((f) => `"${f}"`).join(","));
  assert.ok(lines[1].startsWith('"maria@example.com","Yes","1HGCM82633A004352","Service",'));
});

test("file names follow CARFAX convention", () => {
  const ts = new Date(2026, 8, 22).getTime(); // local (shop) date
  assert.equal(serviceFileName(CFG, "HIST", ts), "BOLTBADGER_HIST_RO_09222026.txt");
  assert.equal(serviceFileName(CFG, "PROD", ts), "BOLTBADGER_PROD_RO_09222026.txt");
  assert.equal(loyaltyFileName(CFG, "HIST", ts), "BOLTBADGER_CustomerList_HIST_09222026.csv");
});
