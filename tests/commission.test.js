import { test } from "node:test";
import assert from "node:assert/strict";
import { commissionForOrder, splitCommission, orderCrew, commissionByEmployee } from "../src/lib/commission.js";

const packages = [
  { id: "syn", name: "Valvoline Full Synthetic Oil Change", commission: 0 },
  { id: "ml", name: "Valvoline MaxLife Oil Change", commission: 3 },
];
const jobs = {
  j1: { id: "j1", name: "Transmission fluid exchange", commission: 12 },
  j2: { id: "j2", name: "Coolant flush and fill", commission: 8 },
  j3: { id: "j3", name: "Engine air filter replacement", commission: 5 },
  j4: { id: "j4", name: "Tire rotation" }, // no commission set
};

test("a ticket sums the commission of each distinct service", () => {
  const order = {
    lines: [
      { kind: "labor", job: "Valvoline Full Synthetic Oil Change", description: "Oil change" },
      { kind: "labor", job: "Transmission fluid exchange", description: "Trans exchange" },
      { kind: "part", job: "Transmission fluid exchange", description: "ATF", qty: 12 },
      { kind: "labor", job: "Coolant flush and fill", description: "Coolant flush" },
    ],
  };
  const { total, items } = commissionForOrder(order, jobs, packages);
  assert.equal(total, 20); // 0 (oil) + 12 (trans) + 8 (coolant)
  assert.equal(items.length, 2);
});

test("a service pays once even if it has several lines, and à la carte parts pay nothing", () => {
  const order = {
    lines: [
      { kind: "labor", job: "Engine air filter replacement", description: "AF" },
      { kind: "part", job: "Engine air filter replacement", description: "Filter" },
      { kind: "part", job: "", description: "Wiper blade (walk-in)" },
    ],
  };
  assert.equal(commissionForOrder(order, jobs, packages).total, 5);
});

test("a job with no commission set pays nothing", () => {
  const order = { lines: [{ kind: "labor", job: "Tire rotation", description: "Rotate" }] };
  assert.equal(commissionForOrder(order, jobs, packages).total, 0);
});

test("an oil package's commission is used, and wins over a same-named job", () => {
  const order = { lines: [{ kind: "labor", job: "Valvoline MaxLife Oil Change", description: "OC" }] };
  assert.equal(commissionForOrder(order, jobs, packages).total, 3);
});

test("split divides by the shop's shares with the remainder to the advisor", () => {
  const s = splitCommission(20, { advisor: 40, top: 30, pit: 30 });
  assert.deepEqual(s, { advisor: 8, top: 6, pit: 6 });
  // odd cents: 10 at equal thirds -> 3.34 / 3.33 / 3.33, summing to 10
  const t = splitCommission(10, { advisor: 1, top: 1, pit: 1 });
  assert.equal(round(t.advisor + t.top + t.pit), 10);
  assert.equal(t.advisor, 3.34);
});

test("split with no shares or no total pays zero", () => {
  assert.deepEqual(splitCommission(0, { advisor: 40, top: 30, pit: 30 }), { advisor: 0, top: 0, pit: 0 });
  assert.deepEqual(splitCommission(20, { advisor: 0, top: 0, pit: 0 }), { advisor: 0, top: 0, pit: 0 });
});

test("crew falls back to the older writer/tech fields", () => {
  assert.deepEqual(orderCrew({ advisorId: "a", topTechId: "b", pitTechId: "c" }), { advisorId: "a", topId: "b", pitId: "c" });
  assert.deepEqual(orderCrew({ writerId: "w", techId: "t" }), { advisorId: "w", topId: "t", pitId: null });
});

test("commissionByEmployee rolls up each person's share across tickets", () => {
  const orders = [
    { id: "o1", advisorId: "sam", topTechId: "mia", pitTechId: "leo", lines: [{ kind: "labor", job: "Transmission fluid exchange" }] }, // $12
    { id: "o2", advisorId: "sam", topTechId: "leo", pitTechId: "mia", lines: [{ kind: "labor", job: "Coolant flush and fill" }] }, // $8
  ];
  const { by, grand, paid } = commissionByEmployee(orders, jobs, packages, { advisor: 50, top: 25, pit: 25 });
  assert.equal(grand, 20);
  assert.equal(paid, 20);
  assert.equal(by.sam.total, 10); // 50% of 12 + 50% of 8
  assert.equal(by.sam.advisor, 10);
  assert.equal(by.mia.total, 5); // top on o1 (3) + pit on o2 (2)
  assert.equal(by.leo.total, 5); // pit on o1 (3) + top on o2 (2)
  assert.equal(by.sam.tickets.size, 2);
});

test("an unassigned role is counted in grand but paid to no one", () => {
  const orders = [{ id: "o1", advisorId: "sam", lines: [{ kind: "labor", job: "Transmission fluid exchange" }] }]; // no top/pit
  const { by, grand, paid } = commissionByEmployee(orders, jobs, packages, { advisor: 50, top: 25, pit: 25 });
  assert.equal(grand, 12);
  assert.equal(by.sam.total, 6);
  assert.equal(paid, 6);
});

function round(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
