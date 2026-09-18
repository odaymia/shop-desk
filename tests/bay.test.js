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
      { kind: "part", packaged: true, qty: 1, number: "COF", description: "Oil filter", job: "Valvoline Euro Full Synthetic Oil Change" },
    ],
  });
  assert.equal(c.oil.quarts, 5.8); // 5 included + 0.8 overage, combined
  assert.equal(c.oil.filter, "COF");
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
