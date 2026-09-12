import { test } from "node:test";
import assert from "node:assert/strict";
import { buildYmme, modelYears } from "../src/lib/ymme.js";

const vehicles = {
  a: { year: 2020, make: "Toyota", model: "Camry", engine: "2.5L 4-cyl" },
  b: { year: 2020, make: "Toyota", model: "Camry", engine: "3.5L V6" },
  c: { year: 2019, make: "Toyota", model: "Corolla", engine: "1.8L 4-cyl" },
  d: { year: 2021, make: "Honda", model: "Accord", engine: "1.5L Turbo" },
  e: { year: "", make: "Ford", model: "F-150", engine: "5.0L V8" }, // no year
};
const specs = {
  s: { year: 2022, make: "Toyota", model: "Camry", engine: "2.5L Hybrid" },
};

test("makes for a year, then models for the make, then engines for the model", () => {
  const y = buildYmme(vehicles, specs);
  assert.deepEqual(y.years, [2022, 2021, 2020, 2019]);
  assert.deepEqual(y.makesFor(2020), ["Toyota"]);
  assert.deepEqual(y.modelsFor(2020, "Toyota"), ["Camry"]);
  assert.deepEqual(y.enginesFor(2020, "Toyota", "Camry"), ["2.5L 4-cyl", "3.5L V6"]);
});

test("a spec-only engine shows up in the list for its year", () => {
  const y = buildYmme(vehicles, specs);
  assert.deepEqual(y.enginesFor(2022, "Toyota", "Camry"), ["2.5L Hybrid"]);
});

test("case and spacing don't create duplicates", () => {
  const y = buildYmme({ a: { year: 2020, make: "toyota ", model: "CAMRY", engine: "2.5L" }, b: { year: 2020, make: "Toyota", model: "Camry", engine: "2.5l" } }, {});
  assert.deepEqual(y.makesFor(2020), ["toyota"]);
  assert.equal(y.enginesFor(2020, "Toyota", "Camry").length, 1);
});

test("an exact year with nothing falls back to what the make/model has shown any year", () => {
  const y = buildYmme(vehicles, {});
  // no 2023 Toyota Camry on file, but the engines it has had still come up
  assert.deepEqual(y.enginesFor(2023, "Toyota", "Camry"), ["2.5L 4-cyl", "3.5L V6"]);
  assert.deepEqual(y.makesFor(2099).includes("Toyota"), true); // falls back to all makes
});

test("a car with no year still feeds makes/models across years", () => {
  const y = buildYmme(vehicles, {});
  assert.deepEqual(y.enginesFor(2010, "Ford", "F-150"), ["5.0L V8"]);
});

test("model years run newest first down to 1981", () => {
  const ys = modelYears(2026);
  assert.equal(ys[0], "2027");
  assert.equal(ys[ys.length - 1], "1981");
});
