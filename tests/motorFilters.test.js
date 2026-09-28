import { test } from "node:test";
import assert from "node:assert/strict";
import { pickEngine, specFromMotorFilters, mergeMotorFilters } from "../src/lib/motorFilters.js";
import { matchFilter } from "../src/lib/specs.js";

/* shaped like the sandbox answer for BaseVehicleID 22123 (2008-12 Accord) */
const engines = [
  { id: "3476", description: "3.5L V6 (J35Z2) GAS FI", liters: "3.5", cylinders: "6", code: "J35Z2" },
  { id: "3477", description: "2.4L L4 (K24Z3) GAS FI", liters: "2.4", cylinders: "4", code: "K24Z3" },
  { id: "3478", description: "2.4L L4 (K24Z2) GAS FI", liters: "2.4", cylinders: "4", code: "K24Z2" },
];
const result = {
  engines,
  parts: [
    { type: "oil", engineId: "3476", numbers: ["VO-106"] },
    { type: "oil", engineId: "3477", numbers: ["VO-106"] },
    { type: "air", engineId: "3476", numbers: ["VA10467"] },
    { type: "cabin", engineId: "3476", numbers: ["VC10285"] },
    { type: "wiper", engineId: "3476", position: "Front Left", label: "Beam Blade", numbers: ["VB-26"] },
    { type: "wiper", engineId: "3476", position: "Front Right", label: "Beam Blade", numbers: ["VB-19"] },
  ],
};

test("the car's MOTOR engine: VIN id, then engine code, then size", () => {
  assert.equal(pickEngine(engines, { engineId: 3477 }), "3477");
  assert.equal(pickEngine(engines, { engineText: "2.4L K24Z2" }), "3478");
  assert.equal(pickEngine(engines, { engineText: "3.5L V6" }), "3476");
  assert.equal(pickEngine(engines, { engineText: "2.4L 4-cyl" }), "3477");
  assert.equal(pickEngine(engines, { engineText: "" }), null);
  assert.equal(pickEngine([engines[0]], {}), "3476");
});

test("MOTOR parts become spec fields for that engine", () => {
  const s = specFromMotorFilters(result, "3476");
  assert.deepEqual(s.oilFilters, [{ brand: "Valvoline", number: "VO-106" }]);
  assert.deepEqual(s.airFilters.map((f) => f.number), ["VA10467"]);
  assert.deepEqual(s.wipers, [
    { side: "Driver", kind: "Beam Blade", number: "VB-26" },
    { side: "Passenger", kind: "Beam Blade", number: "VB-19" },
  ]);
  assert.deepEqual(specFromMotorFilters(result, "3477").airFilters, []);
});

test("merging keeps what the shop typed, and the oil filter lights up in inventory", () => {
  const spec = { oilViscosity: "0W-20", oilFilters: [{ brand: "Fram", number: "XG7317" }], wipers: [] };
  const merged = mergeMotorFilters(spec, specFromMotorFilters(result, "3476"));
  assert.deepEqual(merged.oilFilters.map((f) => f.number), ["XG7317", "VO-106"]);
  assert.equal(merged.oilViscosity, "0W-20");
  assert.equal(merged.wipers.length, 2);
  // "VO-106" from MOTOR matches the VO106 on the shelf
  const parts = { f1: { id: "f1", number: "VO106", description: "Engine oil filter" } };
  assert.deepEqual(matchFilter(parts, merged.oilFilters).map((p) => p.id), ["f1"]);
  // running it twice doesn't double up
  assert.equal(mergeMotorFilters(merged, specFromMotorFilters(result, "3476")).oilFilters.length, 2);
});
