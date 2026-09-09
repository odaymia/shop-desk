import { test } from "node:test";
import assert from "node:assert/strict";
import { dueServices, portalPayload, shopPublicPayload } from "../src/lib/portal.js";

const cfg = { shopName: "Genie", taxRate: 7.75, partsTaxable: true, laborTaxable: false, suppliesPct: 0, laborRate: 150 };
const now = Date.UTC(2026, 8, 8);
const v = { id: "v1", customerId: "c1", year: 2019, make: "Toyota", model: "Camry", engine: "2.5L 4-cyl", mileage: 52000, plate: "8ABC123" };
const orders = [
  { id: "o1", number: 4400, status: "invoiced", vehicleId: "v1", customerId: "c1", invoicedAt: now - 120 * 86400000, mileageIn: 48000,
    lines: [{ kind: "part", description: "5W-30 oil", qty: 5, price: 8, job: "Oil change" }, { kind: "labor", description: "Lube, oil, and filter", hours: 0.3, rate: 100 }], payments: [] },
  { id: "o2", number: 4300, status: "invoiced", vehicleId: "v1", customerId: "c1", invoicedAt: now - 400 * 86400000, mileageIn: 40000,
    lines: [{ kind: "labor", description: "Replace front brake pads", hours: 1, rate: 170 }], payments: [] },
  { id: "o3", number: 4500, status: "estimate", vehicleId: "v1", customerId: "c1", createdAt: now, lines: [], payments: [] },
];

test("due services come from the last invoice that did each one", () => {
  const due = dueServices(orders, v, undefined, now);
  const oil = due.find((d) => d.key === "oil");
  assert.equal(oil.lastMiles, 48000);
  assert.equal(oil.dueMiles, 53000);
  assert.equal(oil.status, "ok"); // 120 days into a 6-month interval, 1,000 miles from the mileage mark
  assert.equal(dueServices(orders, { ...v, mileage: 52800 }, undefined, now).find((d) => d.key === "oil").status, "soon");
  assert.equal(dueServices(orders, { ...v, mileage: 53500 }, undefined, now).find((d) => d.key === "oil").status, "overdue");
  const brakes = due.find((d) => d.key === "brakes");
  assert.equal(brakes.status, "overdue"); // 400 days ago, 12-month rule
  assert.equal(due.find((d) => d.key === "rotation"), undefined);
});

test("portal payload has vehicles, history and no estimates", () => {
  const p = portalPayload({ customer: { id: "c1", first: "Maria", last: "Lopez", createdAt: 1 }, vehicles: [v], orders, specs: {}, parts: {}, cfg, jobs: {} });
  assert.equal(p.name, "Maria Lopez");
  assert.equal(p.vehicles.length, 1);
  assert.equal(p.vehicles[0].history.length, 2);
  assert.equal(p.vehicles[0].history[0].number, 4400);
  assert.equal(p.vehicles[0].history[0].total, 73.1); // 40 parts + 30 labor + tax on 40
  assert.equal(p.vehicles[0].oil, null);
});

test("shop public card carries only jobs marked for the portal", () => {
  const jobs = {
    a: { name: "Front brake pads", category: "Brakes", portal: true, lines: [{ kind: "part", description: "Pads", qty: 1, price: 49.99 }, { kind: "labor", description: "Replace pads", hours: 1, rate: 170 }] },
    b: { name: "Secret job", portal: false, lines: [{ kind: "labor", description: "x", hours: 1, rate: 1 }] },
  };
  const s = shopPublicPayload(cfg, jobs, {});
  assert.equal(s.menu.length, 1);
  assert.equal(s.menu[0].price, 219.99);
  assert.equal(s.name, "Genie");
});
