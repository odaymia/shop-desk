import { test } from "node:test";
import assert from "node:assert/strict";
import { specKey, findSpec, normalizeViscosity, matchOil, matchFilter, oilChangeLines } from "../src/lib/specs.js";
import { valvolineFor } from "../src/lib/valvoline.js";

const camry19 = { year: 2019, make: "Toyota", model: "Camry", engine: "2.5L 4-cyl" };
const specs = {
  a: { year: 2018, make: "Toyota", model: "Camry", engine: "2.5L 4-cyl", oilViscosity: "0W-16", oilCapacityQt: 4.8, oilFilters: [{ brand: "Toyota", number: "04152-YZZA6" }] },
  b: { year: 2022, make: "Toyota", model: "Camry", engine: "2.5L 4-cyl", oilViscosity: "0W-16", oilCapacityQt: 4.8, oilFilters: [] },
  c: { year: 2019, make: "Honda", model: "Accord", engine: "1.5L 4-cyl", oilViscosity: "0W-20", oilCapacityQt: 3.7, oilFilters: [] },
};

test("spec keys and nearest-year fallback", () => {
  assert.equal(specKey(camry19), "2019|toyota|camry|2.5l 4-cyl");
  const r = findSpec(specs, camry19);
  assert.equal(r.exact, false);
  assert.equal(r.spec.year, 2018); // 2018 is one year away, 2022 is three
  assert.equal(findSpec(specs, { ...camry19, year: 2022 }).exact, true);
  assert.equal(findSpec(specs, { year: 2019, make: "Ford", model: "F-150", engine: "" }), null);
});

test("viscosity normalizes and matches stocked oil", () => {
  assert.equal(normalizeViscosity("0w20"), "0W-20");
  assert.equal(normalizeViscosity("5W-30 "), "5W-30");
  const parts = {
    p1: { id: "p1", number: "M1-0W20", description: "Mobil 1 0W-20 Full Synthetic, quart", price: 9.99, cost: 6 },
    p2: { id: "p2", number: "PH3614", description: "Engine oil filter", price: 9.99, cost: 4.1 },
    p3: { id: "p3", number: "04152YZZA6", description: "Toyota oil filter", price: 12, cost: 6 },
  };
  assert.deepEqual(matchOil(parts, "0W-20").map((p) => p.id), ["p1"]);
  assert.deepEqual(matchFilter(parts, [{ number: "04152-YZZA6" }]).map((p) => p.id), ["p3"]);
  let n = 0;
  const lines = oilChangeLines(specs.a, parts, () => `L${++n}`, { oilChangeLaborPrice: 29.99 });
  assert.equal(lines.length, 3);
  assert.equal(lines[0].qty, 4.8);
  assert.equal(lines[0].partId, null); // no 0W-16 stocked
  assert.equal(lines[1].partId, "p3");
  assert.equal(lines[2].rate, 29.99);
  assert.equal(oilChangeLines(specs.a, parts, () => "x", {}).length, 2);
});

test("Valvoline suggestions by grade, high mileage and European specs first", () => {
  const v = valvolineFor("0W-20", "API SP", 80000);
  assert.equal(v[0].product.includes("MaxLife"), true);
  const e = valvolineFor("5W-40", "VW 502 00 / MB 229.5", 20000);
  assert.equal(e[0].line, "European Vehicle Full Synthetic");
  assert.equal(valvolineFor("", "", 0).length, 0);
});
