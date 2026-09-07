import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTireSize, isTireSize, tireSizeKey, tireBrandModel, tireName } from "../src/lib/tires.js";

test("tire sizes normalize to width/sidewall R rim", () => {
  assert.equal(normalizeTireSize("225/65r17"), "225/65R17");
  assert.equal(normalizeTireSize("225 65 17"), "225/65R17");
  assert.equal(normalizeTireSize("P225/65R17"), "225/65R17");
  assert.equal(normalizeTireSize("LT265/70R17"), "265/70R17");
  assert.equal(normalizeTireSize("235/65R16C"), "235/65R16C");
  assert.equal(normalizeTireSize("205/60/R16"), "205/60R16");
  assert.equal(normalizeTireSize("235/45ZR18"), "235/45R18");
  assert.equal(normalizeTireSize("31X10.50R15"), "31X10.50R15");
  assert.equal(isTireSize("31X10.50R15"), true);
  assert.equal(isTireSize("225/65R17"), true);
  assert.equal(isTireSize("NOTASIZE"), false);
});

test("sizes sort by rim, then width, then sidewall", () => {
  const sizes = ["225/65R17", "205/55R16", "235/45R17", "275/55R20"].sort((a, b) => {
    const x = tireSizeKey(a), y = tireSizeKey(b);
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
  assert.deepEqual(sizes, ["205/55R16", "225/65R17", "235/45R17", "275/55R20"]);
});

test("imported tire descriptions split into brand and model", () => {
  assert.deepEqual(tireBrandModel({ description: "Ironman, iMOVE GEN 3 AS" }), { brand: "Ironman", model: "iMOVE GEN 3 AS" });
  assert.equal(tireName({ brand: "Michelin", model: "Defender 2" }), "Michelin Defender 2");
  assert.equal(tireName({ description: "Toyo Open Country" }), "Toyo Open Country");
});
