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

import { DEFAULT_CFG } from "../src/lib/config.js";
import { schedFromMerge, applySched, sameSched, vehicleReviewRows, mergeMotorIntervals, DEFAULT_SERVICE_INTERVALS } from "../src/lib/serviceReview.js";

const customer1 = { id: "c1", first: "Ana", last: "Lopez", email: "ana@example.com" };

test("garage: the page builds with the shop's real settings (the service-review table is not the reminder map)", () => {
  // DEFAULT_CFG carries serviceIntervals as the Service Review list; this used to throw on any car with an invoice
  const p = portalPayload({ customer: customer1, vehicles: [v], orders, specs: {}, parts: {}, cfg: { ...DEFAULT_CFG, ...cfg }, jobs: {} });
  const car = p.vehicles[0];
  assert.ok(car.due.some((d) => d.key === "oil")); // the older reminder list still works
  assert.ok(car.review); // and the service review rides along
});

test("garage: each car carries the shop's service review, checked against its own history", () => {
  // the page is built as of today, so date the oil change from today: 60 days and 4,000 mi ago
  const recent = orders.map((o) => (o.id === "o1" ? { ...o, invoicedAt: Date.now() - 60 * 86400000 } : o));
  const p = portalPayload({ customer: customer1, vehicles: [v], orders: recent, specs: {}, parts: {}, cfg: { ...DEFAULT_CFG, ...cfg, serviceIntervalSource: "store" }, jobs: {} });
  const r = p.vehicles[0].review;
  assert.equal(r.mileageText, "52,000 mi");
  const names = (list) => list.map((x) => x.name);
  // 52,000 mi with no record: the long-interval items a car this age needs are recommended
  assert.ok(names(r.recommended).includes("Brake fluid service"));
  assert.ok(names(r.recommended).includes("Differential fluid service"));
  // oil was done 4,000 mi / 2 months ago on a 5,000 mi / 6 mo interval: recommended as due soon, with its reason
  const oil = r.recommended.find((x) => x.id === "oil");
  assert.equal(oil.tone, "soon");
  assert.ok(oil.why.length > 20);
  // inspect-on-visit items are listed apart, with the menu price
  assert.ok(names(r.inspect).includes("Wiper blades"));
  assert.equal(r.inspect.find((x) => x.id === "wipers").priceText, "$25.00");
  assert.ok(r.recommendedTotal > 0);
  assert.match(r.recommendedTotalText, /^\$\d/);
  // trimmed for the page: no interval numbers, no shop block
  assert.equal(r.shopName, undefined);
  assert.equal(r.recommended[0].every, undefined);
});

test("garage: a service checked off for the car stays off its garage review too", () => {
  const car = { ...v, serviceSkip: ["diff", "psFluid"] };
  const p = portalPayload({ customer: customer1, vehicles: [car], orders, specs: {}, parts: {}, cfg: { ...DEFAULT_CFG, ...cfg, serviceIntervalSource: "store" }, jobs: {} });
  const all = [...p.vehicles[0].review.recommended, ...p.vehicles[0].review.inspect, ...p.vehicles[0].review.upToDate].map((x) => x.id);
  assert.ok(!all.includes("diff") && !all.includes("psFluid"));
  assert.ok(all.includes("brakeFluid"));
});

test("garage: the factory schedule the in-shop review found is reused, so both show the same answer", () => {
  const base = DEFAULT_SERVICE_INTERVALS;
  // MOTOR: coolant is a 100,000 mi item on this car, and it has no power steering fluid
  const applicable = base.filter((x) => x.id !== "psFluid");
  const merged = mergeMotorIntervals(applicable, [{ name: "Engine Coolant Replace", serviceType: "Replace", miles: 100000, months: 120 }], "motor").intervals;
  const sched = schedFromMerge(base, merged);
  assert.deepEqual(sched, { hidden: ["psFluid"], items: { coolant: { miles: 100000, months: 120 } } });
  assert.ok(sameSched(sched, JSON.parse(JSON.stringify(sched))));
  assert.ok(sameSched(undefined, { hidden: [], items: {} })); // nothing found is the same as no note
  assert.ok(!sameSched(sched, { hidden: [], items: {} }));

  const applied = applySched(base, sched);
  assert.ok(!applied.some((x) => x.id === "psFluid"));
  assert.equal(applied.find((x) => x.id === "coolant").miles, 100000);
  assert.equal(applied.find((x) => x.id === "trans").miles, 60000); // untouched rows keep the shop's number
  assert.equal(applySched(base, null), base);

  // a 70,000 mi car with no coolant record: due on the shop's 60,000 mi rule, not due on the factory 100,000
  const car = { id: "v9", mileage: 70000 };
  const store = vehicleReviewRows({ cfg: { serviceIntervalSource: "both" }, vehicle: car, orders: [] }).rows;
  assert.equal(store.find((x) => x.id === "coolant").status, "due");
  const withSched = vehicleReviewRows({ cfg: { serviceIntervalSource: "both" }, vehicle: { ...car, serviceSched: sched }, orders: [] }).rows;
  assert.equal(withSched.find((x) => x.id === "coolant").status, "unknown");
  assert.ok(!withSched.some((x) => x.id === "psFluid"));
  // a shop that runs store-only ignores the note
  const storeOnly = vehicleReviewRows({ cfg: { serviceIntervalSource: "store" }, vehicle: { ...car, serviceSched: sched }, orders: [] }).rows;
  assert.equal(storeOnly.find((x) => x.id === "coolant").status, "due");
  assert.ok(storeOnly.some((x) => x.id === "psFluid"));
});

test("garage: the review uses the highest mileage on record and prices parts from the shelf", () => {
  const parts = { p1: { id: "p1", number: "WB-22", description: "Wiper blade 22in", category: "Wipers", onHand: 4, price: 14.99 } };
  const rv = vehicleReviewRows({ cfg: {}, vehicle: { ...v, mileage: 50000 }, orders, parts });
  assert.equal(rv.mileage, 50000); // invoices top out at 48,000; the car's own reading is higher
  assert.equal(vehicleReviewRows({ cfg: {}, vehicle: { ...v, mileage: 1000 }, orders, parts }).mileage, 48000);
  assert.equal(rv.rows.find((x) => x.id === "wipers").effPrice, 14.99);
});
