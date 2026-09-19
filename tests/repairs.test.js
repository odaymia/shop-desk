import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestedWork, concernCategories } from "../src/lib/repairs.js";

const cfg = {
  serviceMenu: [
    { id: "m1", name: "Oil change", oil: true },
    { id: "m2", name: "Brakes", category: "Brake service" },
    { id: "m3", name: "A/C service", category: "Air conditioning" },
    { id: "m4", name: "Tires", category: "Tires" },
    { id: "m5", name: "Diagnostics", category: "Diagnosis" },
  ],
};

test("concernCategories maps stated symptoms back to their areas", () => {
  const cats = concernCategories("Grinding noise when braking\nA/C not cold", cfg);
  assert.ok(cats.includes("Noises"));
  assert.ok(cats.includes("A/C & heat"));
});

test("suggestedWork recommends a diagnosis first and the shop's matching repair menus", () => {
  const w = suggestedWork("Brakes feel soft or spongy\nA/C not cold", cfg);
  // diagnose first (BAR-safe)
  assert.ok(w.diagnostics.some((d) => d.label === "Brake inspection"));
  assert.ok(w.diagnostics.some((d) => d.label === "A/C performance check"));
  // the shop's own menu buttons that address the concern
  const names = w.menu.map((m) => m.name);
  assert.ok(names.includes("Brakes"));
  assert.ok(names.includes("A/C service"));
  // unrelated menus don't show
  assert.ok(!names.includes("Tires"));
});

test("suggestedWork is empty when the concern has no recognized symptoms", () => {
  const w = suggestedWork("Customer just wants it looked at", cfg);
  assert.deepEqual(w.diagnostics, []);
  assert.deepEqual(w.menu, []);
  assert.deepEqual(w.categories, []);
});

test("suggestedWork de-dupes a diagnosis shared by two symptoms in the same area", () => {
  const w = suggestedWork("Grinding noise when braking\nSquealing when braking", cfg);
  const noiseDiag = w.diagnostics.filter((d) => d.label === "Inspect and locate the noise");
  assert.equal(noiseDiag.length, 1);
});
