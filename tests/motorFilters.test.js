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

import { specNumbersFor, isNotServiceable } from "../src/lib/motorFilters.js";

test("the part picker's recommended part comes from the spec by category", () => {
  const spec = {
    oilFilters: [{ number: "VO-40" }],
    airFilters: [{ number: "VA-163" }],
    cabinFilters: [{ number: "VCA-1031" }],
    fuelFilters: [{ number: "NS" }],
    wipers: [{ side: "Driver", number: "836454" }],
  };
  assert.deepEqual(specNumbersFor(spec, "Engine Air Filters").map((f) => f.number), ["VA-163"]);
  assert.deepEqual(specNumbersFor(spec, "Cabin Air Filters").map((f) => f.number), ["VCA-1031"]);
  assert.deepEqual(specNumbersFor(spec, "Wipers").map((f) => f.number), ["836454"]);
  assert.deepEqual(specNumbersFor(spec, "Fuel Filters"), []); // "NS" = nothing to sell
  assert.deepEqual(specNumbersFor(null, "Engine Air Filters"), []);
  assert.equal(isNotServiceable("N/S"), true);
});

test("MOTOR's NS fuel filter is marked not serviceable, not saved as a part", () => {
  const s = specFromMotorFilters({ parts: [{ type: "fuel", engineId: "1", numbers: ["NS"] }, { type: "oil", engineId: "1", numbers: ["VO-40"] }] }, "1");
  assert.deepEqual(s.fuelFilters, []);
  assert.equal(s.notServiceable.fuel, true);
});

test("engine from a VIN-decode style engine text, gas over hybrid", () => {
  const cam = [
    { id: "h", description: "2.4L L4 (B) 2AZ-FXE FULL HYBRID EV-GAS (FHEV) FI", liters: "2.4", cylinders: "4" },
    { id: "a", description: "2.5L L4 (2AR-FE) GAS FI", liters: "2.5", cylinders: "4" },
    { id: "b", description: "2.4L L4 (2AZ-FE) GAS FI", liters: "2.4", cylinders: "4" },
  ];
  assert.equal(pickEngine(cam, { engineText: "2.5 16V (USA), ASV40" }), "a");
  assert.equal(pickEngine(cam, { engineText: "2.4L" }), "b");
  assert.equal(pickEngine(cam, { engineText: "2.4L Hybrid" }), "h");
});

import { wiperNotes, wiperSizes, wipersBySize } from "../src/lib/motorFilters.js";

test("wiper size, arm and style come from MOTOR's notes (2010 Camry 2.5L)", () => {
  assert.deepEqual(wiperNotes(["Original (OEM): Hybrid", "Arm Connector: Hook 9x3", "24 in."]), { oemStyle: "Hybrid", connector: "Hook 9x3", size: "24" });
  const s = specFromMotorFilters(
    {
      parts: [
        { type: "wiper", engineId: "10182", position: "Front Left", label: "Standard Blade", numbers: ["836454"], items: [{ number: "836454", notes: ["Original (OEM): Hybrid", "Arm Connector: Hook 9x3", "24 in."] }] },
        { type: "wiper", engineId: "10182", position: "Front Right", label: "Standard Blade", numbers: ["836451"], items: [{ number: "836451", notes: ["19 in."] }] },
        { type: "wiper", engineId: "10182", position: "Front Left", label: "Beam Blade", numbers: ["836538"], items: [{ number: "836538", notes: ["24 in."] }] },
      ],
    },
    "10182"
  );
  assert.deepEqual(wiperSizes(s), { Driver: "24", Passenger: "19" });
  assert.equal(s.wipers[0].connector, "Hook 9x3");
  // a new lookup replaces wipers saved before sizes were read
  assert.equal(mergeMotorFilters({ wipers: [{ side: "Driver", number: "836454" }] }, s).wipers[0].size, "24");
});

test("any brand of blade in stock matches by size", () => {
  const parts = {
    a: { id: "a", number: "WB-24", description: "Wiper blade", category: "Wipers" },
    b: { id: "b", number: "RX-19B", description: "Rain-X Latitude 19\"", category: "Wipers" },
    c: { id: "c", number: "WB-22", description: "Wiper blade 22\"", category: "Wipers" },
    d: { id: "d", number: "CA10467", description: "Engine air filter 24", category: "Filters" },
  };
  assert.deepEqual(wipersBySize(parts, ["24", "19"]).map((p) => p.id).sort(), ["a", "b"]);
  assert.deepEqual(wipersBySize(parts, []), []);
});
