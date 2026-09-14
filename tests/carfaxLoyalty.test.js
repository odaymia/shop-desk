import { test } from "node:test";
import assert from "node:assert/strict";
import { loyaltyRows, loyaltyFile, loyaltyFileName, LOYALTY_FIELDS } from "../src/lib/carfaxLoyalty.js";

const cfg = { carfaxProviderId: "2743", carfaxLocationId: "SHOPDESK6195550142" };
const customers = {
  c1: { id: "c1", first: "John", last: "Doe", email: "john@doe.com", phone: "(619) 555-1212", zip: "92064", carfaxEmailOptIn: true, carfaxCellOptIn: true },
  c2: { id: "c2", first: "Jane", last: "Smith", email: "", phone: "540-555-1212" }, // reachable by cell only, no consent
  c3: { id: "c3", first: "No", last: "Contact", email: "", phone: "" }, // no way to reach
};
const vehicles = {
  v1: { id: "v1", vin: "2HKRL186XYH005802" },
  v2: { id: "v2", vin: "1B4GP55L0TB234185" },
  vbad: { id: "vbad", vin: "SHORTVIN" },
};
const at = (y, m, d) => new Date(y, m - 1, d).getTime();
const orders = {
  o1: { id: "o1", status: "invoiced", customerId: "c1", vehicleId: "v1", invoicedAt: at(2026, 3, 10) },
  o2: { id: "o2", status: "invoiced", customerId: "c2", vehicleId: "v2", invoicedAt: at(2026, 2, 22) },
  o3: { id: "o3", status: "invoiced", customerId: "c3", vehicleId: "v1", invoicedAt: at(2026, 3, 1) }, // unreachable → skip
  o4: { id: "o4", status: "invoiced", customerId: "c1", vehicleId: "vbad", invoicedAt: at(2026, 3, 5) }, // bad VIN → skip
  o5: { id: "o5", status: "estimate", customerId: "c1", vehicleId: "v1", invoicedAt: at(2026, 3, 8) }, // not invoiced → skip
};

test("one row per reachable customer + VIN + service date, invoiced only", () => {
  const rows = loyaltyRows(orders, customers, vehicles, cfg, 0);
  assert.equal(rows.length, 2);
  const john = rows.find((r) => r.LAST_NAME === "Doe");
  assert.equal(john.EMAIL, "john@doe.com");
  assert.equal(john.VIN, "2HKRL186XYH005802");
  assert.equal(john.OPERATION_TYPE, "Service");
  assert.equal(john.OPERATION_SALE_TYPE, "");
  assert.equal(john.OPERATION_DATE, "03/10/2026");
  assert.equal(john.CELLPHONE, "6195551212");
  assert.equal(john.PROVIDER_ID, "2743");
  assert.equal(john.LOCATION_ID, "SHOPDESK6195550142");
});

test("opt-in is Yes only when the customer's record says so", () => {
  const rows = loyaltyRows(orders, customers, vehicles, cfg, 0);
  const john = rows.find((r) => r.LAST_NAME === "Doe");
  const jane = rows.find((r) => r.LAST_NAME === "Smith");
  assert.equal(john.EMAIL_OPT_IN, "Yes");
  assert.equal(john.CELLPHONE_OPT_IN, "Yes");
  assert.equal(jane.EMAIL_OPT_IN, "No"); // no email at all
  assert.equal(jane.CELLPHONE_OPT_IN, "No"); // no consent flag
  assert.equal(jane.CELLPHONE, "5405551212");
});

test("the 24-month window drops older transactions", () => {
  const since = at(2026, 3, 1);
  const rows = loyaltyRows(orders, customers, vehicles, cfg, since);
  assert.equal(rows.length, 1); // only John's 3/10 survives; Jane's 2/22 is before the cutoff
  assert.equal(rows[0].LAST_NAME, "Doe");
});

test("the same customer/VIN/date is not duplicated", () => {
  const dup = { ...orders, o1b: { id: "o1b", status: "invoiced", customerId: "c1", vehicleId: "v1", invoicedAt: at(2026, 3, 10) } };
  const rows = loyaltyRows(dup, customers, vehicles, cfg, 0);
  assert.equal(rows.filter((r) => r.LAST_NAME === "Doe").length, 1);
});

test("the CSV is comma-delimited, quoted, with the header in spec order", () => {
  const rows = loyaltyRows(orders, customers, vehicles, cfg, 0);
  const csv = loyaltyFile(rows);
  const lines = csv.trim().split("\n");
  assert.equal(lines[0], LOYALTY_FIELDS.map((f) => `"${f}"`).join(","));
  assert.equal(LOYALTY_FIELDS[0], "EMAIL");
  assert.equal(LOYALTY_FIELDS[LOYALTY_FIELDS.length - 1], "LOCATION_ID");
  assert.ok(lines[1].startsWith('"'));
  assert.equal(lines[1].split('","').length, LOYALTY_FIELDS.length);
});

test("file name follows PartnerName_CustomerList_HIST_MMDDYYYY.csv", () => {
  assert.equal(loyaltyFileName("ShopDesk", "HIST", new Date(2026, 8, 14)), "ShopDesk_CustomerList_HIST_09142026.csv");
  assert.equal(loyaltyFileName("ShopDesk", "PROD", new Date(2026, 8, 14)), "ShopDesk_CustomerList_PROD_09142026.csv");
});
