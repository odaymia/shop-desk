import { test } from "node:test";
import assert from "node:assert/strict";
import { planMerge, remap, mergeCustomer, mergeVehicle, isSymbolPlaceholder, planUnlinkPlaceholders } from "../src/lib/importMerge.js";

test("isSymbolPlaceholder: symbol/blank names with no phone or email; letters or contact make it safe", () => {
  assert.equal(isSymbolPlaceholder({ first: ".", last: "" }), true);
  assert.equal(isSymbolPlaceholder({ first: ",", last: "'" }), true);
  assert.equal(isSymbolPlaceholder({ first: "", last: "" }), true);
  assert.equal(isSymbolPlaceholder({ first: "Al", last: "" }), false); // has letters
  assert.equal(isSymbolPlaceholder({ company: "Acme" }), false); // company name
  assert.equal(isSymbolPlaceholder({ first: ".", phone: "619-555-0142" }), false); // phone identifies them
  assert.equal(isSymbolPlaceholder({ first: ".", email: "a@b.com" }), false); // email identifies them
});

test("planUnlinkPlaceholders un-links only symbol customers that own more than one car", () => {
  const customers = {
    dot: { id: "dot", first: ",", last: "", active: true }, // symbol, 3 cars -> target
    solo: { id: "solo", first: ".", last: "", active: true }, // symbol, 1 car -> left alone
    real: { id: "real", first: "Maria", last: "Alvarez", active: true }, // named -> left alone
    fleet: { id: "fleet", first: "", last: "", phone: "6195551234", active: true }, // phone id -> left alone
  };
  const vehicles = {
    v1: { id: "v1", customerId: "dot", active: true },
    v2: { id: "v2", customerId: "dot", active: true },
    v3: { id: "v3", customerId: "dot", active: true },
    v4: { id: "v4", customerId: "solo", active: true },
    v5: { id: "v5", customerId: "real", active: true },
    v6: { id: "v6", customerId: "fleet", active: true },
    v7: { id: "v7", customerId: "fleet", active: true },
  };
  const orders = { o1: { id: "o1", customerId: "dot", vehicleId: "v1" }, o2: { id: "o2", customerId: "real", vehicleId: "v5" } };
  const plan = planUnlinkPlaceholders({ customers, vehicles, orders });
  assert.deepEqual(plan.customers.map((c) => c.id), ["dot"]);
  assert.equal(plan.customers[0].active, false); // retired
  assert.deepEqual(plan.vehicles.map((v) => v.id).sort(), ["v1", "v2", "v3"]);
  assert.ok(plan.vehicles.every((v) => v.customerId === null));
  assert.deepEqual(plan.orders.map((o) => o.id), ["o1"]);
  assert.equal(plan.orders[0].customerId, null);
  assert.deepEqual(plan.counts, { customers: 1, vehicles: 3, orders: 1 });
});

const existing = {
  customers: { m1c1: { id: "m1c1", first: "Maria", last: "Lopez", phone: "6195550142", email: "" } },
  vehicles: { m1v1: { id: "m1v1", customerId: "m1c1", vin: "1HGCM82633A004352", plate: "8ABC123", mileage: 140000 } },
};
const bundle = {
  customers: [
    { id: "lsc1", first: "", last: ".", phone: "" }, // LubeSoft walk-in placeholder
    { id: "lsc2", first: "Maria", last: "L", phone: "(619) 555-0142", email: "maria@example.com" },
    { id: "lsc3", first: "New", last: "Person", phone: "6195550199" },
  ],
  vehicles: [
    { id: "lsv1", customerId: "lsc1", vin: "1HGCM82633A004352", plate: "CA-8ABC123", mileage: 148200 },
    { id: "lsv2", customerId: "lsc3", vin: "", plate: "CA-9ZZZ999" },
  ],
  orders: [{ id: "lso1", vehicleId: "lsv1", customerId: "lsc1" }],
};

test("cars match by VIN or plate, people by phone", () => {
  const plan = planMerge(bundle, existing);
  assert.equal(plan.vehicleMap.lsv1, "m1v1");
  assert.equal(plan.vehicleMap.lsv2, undefined);
  assert.equal(plan.customerMap.lsc2, "m1c1");
  assert.equal(plan.customerMap.lsc3, undefined);
  assert.equal(plan.dropCustomers.has("lsc1"), true);
  assert.deepEqual(plan.counts, { customersMatched: 1, vehiclesMatched: 1, customersDropped: 1 });
});

test("remap sends history to the existing car and its owner", () => {
  const plan = planMerge(bundle, existing);
  const v = remap("vehicles", bundle.vehicles[0], plan);
  assert.equal(v.id, "m1v1");
  assert.equal(v.customerId, "m1c1");
  const o = remap("orders", bundle.orders[0], plan);
  assert.equal(o.vehicleId, "m1v1");
  assert.equal(o.customerId, "m1c1");
  const c = remap("customers", bundle.customers[1], plan);
  assert.equal(c.id, "m1c1");
});

test("merging fills blanks and keeps the higher mileage", () => {
  const c = mergeCustomer(existing.customers.m1c1, bundle.customers[1]);
  assert.equal(c.last, "Lopez");
  assert.equal(c.email, "maria@example.com");
  const v = mergeVehicle(existing.vehicles.m1v1, bundle.vehicles[0]);
  assert.equal(v.mileage, 148200);
  assert.equal(v.plate, "8ABC123");
});
