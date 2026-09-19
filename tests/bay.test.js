import { test } from "node:test";
import assert from "node:assert/strict";
import { bayCard } from "../src/lib/bay.js";

const oilOrder = {
  lines: [
    { kind: "labor", oil: true, packaged: true, job: "Valvoline Full Synthetic Oil Change", description: "Full service oil change" },
    { kind: "part", oil: true, packaged: true, qty: 5, description: "Valvoline Full Synthetic 5W-30", job: "Valvoline Full Synthetic Oil Change" },
    { kind: "part", packaged: true, qty: 1, number: "VO106", description: "Oil filter (included)", job: "Valvoline Full Synthetic Oil Change" },
    { kind: "labor", job: "Engine air filter replacement", description: "Replace air filter" },
    { kind: "part", job: "Engine air filter replacement", description: "Engine air filter" },
  ],
};

test("bayCard highlights the oil, quarts, and filter, and lists the services", () => {
  const c = bayCard(oilOrder);
  assert.equal(c.oil.type, "Valvoline Full Synthetic 5W-30");
  assert.equal(c.oil.quarts, 5);
  assert.equal(c.oil.filter, "VO106"); // the filter number, "(included)" stripped
  assert.deepEqual(c.services, ["Valvoline Full Synthetic Oil Change", "Engine air filter replacement"]);
});

test("bayCard sums the oil across split lines when a car takes over the included quarts", () => {
  const c = bayCard({
    lines: [
      { kind: "labor", oil: true, packaged: true, job: "Valvoline Euro Full Synthetic Oil Change", description: "Full synthetic oil change" },
      { kind: "part", oil: true, packaged: true, qty: 5, number: "VR1EU", description: "Valvoline Full Synthetic European 5W-40", job: "Valvoline Euro Full Synthetic Oil Change" },
      { kind: "part", qty: 0.8, partId: "p-vr1eu", number: "VR1EU", description: "Extra oil over 5 qt — Valvoline Full Synthetic European 5W-40", job: "Valvoline Euro Full Synthetic Oil Change" },
      { kind: "part", qty: 1, number: "VR1EU", description: "Bottled oil charge", surchargeForId: "p-vr1eu", surchargeKind: "oil", job: "Valvoline Euro Full Synthetic Oil Change" },
      { kind: "part", packaged: true, qty: 1, number: "COF", description: "Oil filter", job: "Valvoline Euro Full Synthetic Oil Change" },
    ],
  });
  assert.equal(c.oil.quarts, 5.8); // 5 included + 0.8 overage; the bottled-oil surcharge line is NOT a quart
  assert.equal(c.oil.filter, "COF");
});

test("bayCard does not count transmission or radiator fluid as oil quarts", () => {
  const c = bayCard({
    lines: [
      { kind: "labor", oil: true, packaged: true, job: "Valvoline Conventional Oil Change", description: "Full service oil change" },
      { kind: "part", oil: true, packaged: true, qty: 5, number: "5/20", description: "Valvoline Conventional 5W-20", job: "Valvoline Conventional Oil Change" },
      { kind: "part", packaged: true, qty: 1, number: "VO106", description: "Oil filter (included)", job: "Valvoline Conventional Oil Change" },
      // a transmission service, package-priced: its fluid rides on a packaged part line
      { kind: "labor", packaged: true, job: "Transmission service", description: "Drain and fill" },
      { kind: "part", packaged: true, qty: 4, description: "ATF full synthetic" },
      // a radiator flush, likewise
      { kind: "labor", packaged: true, job: "Radiator flush", description: "Flush and refill" },
      { kind: "part", packaged: true, qty: 2, description: "Extended life coolant" },
    ],
  });
  assert.equal(c.oil.quarts, 5); // only the oil-change oil, not the ATF or coolant
  assert.equal(c.oil.filter, "VO106");
  assert.deepEqual(c.services, ["Valvoline Conventional Oil Change", "Transmission service", "Radiator flush"]);
});

test("bayCard lists loose parts added on their own — air filter, cabin filter, wipers", () => {
  const c = bayCard({
    lines: [
      { kind: "labor", oil: true, packaged: true, job: "Valvoline Conventional Oil Change", description: "Full service oil change" },
      { kind: "part", oil: true, packaged: true, qty: 5, number: "5/20", description: "Valvoline Conventional 5W-20", job: "Valvoline Conventional Oil Change" },
      { kind: "part", packaged: true, qty: 1, number: "VO106", description: "Oil filter (included)", job: "Valvoline Conventional Oil Change" },
      // added straight from the part picker, no canned job on them
      { kind: "part", qty: 1, number: "CA10755", description: "FRAM Engine Air Filter" },
      { kind: "part", qty: 1, number: "CF10285", description: "Cabin air filter" },
      { kind: "part", qty: 2, number: "26A", description: "Bosch wiper blade" },
    ],
  });
  assert.deepEqual(c.services, ["Valvoline Conventional Oil Change", "Air filter", "Cabin air filter", "Wiper blades"]);
  assert.equal(c.oil.quarts, 5); // the loose parts don't touch the quart total
});

test("bayCard on a non-oil ticket has no oil block", () => {
  const c = bayCard({ lines: [{ kind: "labor", job: "Front brake pads replacement", description: "Replace pads" }] });
  assert.equal(c.oil, null);
  assert.deepEqual(c.services, ["Front brake pads replacement"]);
});

test("bayCard is safe on an empty or missing ticket", () => {
  assert.deepEqual(bayCard(null), { services: [], oil: null });
  assert.deepEqual(bayCard({ lines: [] }), { services: [], oil: null });
});
