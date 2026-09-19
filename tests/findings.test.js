import { test } from "node:test";
import assert from "node:assert/strict";
import { composeFinding, fixLaborDescription, addFinding, findingsForCategories, FINDINGS_BY_CATEGORY } from "../src/lib/findings.js";

test("composeFinding writes the full inspected/concern/found/recommend sentence", () => {
  const s = composeFinding({
    inspected: "the front brakes",
    concern: "Grinding noise when braking",
    found: "front pads worn to 2mm and rotors scored",
    action: "Replace",
    component: "front brake pads and rotors",
  });
  assert.equal(
    s,
    "Inspected the front brakes because the customer stated: Grinding noise when braking. Found front pads worn to 2mm and rotors scored. Recommend replacing front brake pads and rotors.",
  );
});

test("composeFinding joins multiple concern lines and handles 'further diagnosis'", () => {
  const s = composeFinding({ inspected: "the engine", concern: "Check engine light on\nRough idle", found: "a stored misfire code", action: "Further diagnosis" });
  assert.equal(s, "Inspected the engine because the customer stated: Check engine light on; Rough idle. Found a stored misfire code. Recommend further diagnosis.");
});

test("composeFinding still reads well when half-filled", () => {
  assert.equal(composeFinding({ found: "a coolant leak at the water pump" }), "Inspected the vehicle. Found a coolant leak at the water pump.");
  assert.equal(composeFinding({}), "Inspected the vehicle.");
  // action but no component → the noun form, so it isn't a dangling verb
  assert.equal(composeFinding({ found: "front pads worn", action: "Replace" }), "Inspected the vehicle. Found front pads worn. Recommend replacement.");
});

test("fixLaborDescription is the action + component, or a diagnosis line", () => {
  assert.equal(fixLaborDescription({ action: "Replace", component: "front brake pads" }), "Replace front brake pads");
  assert.equal(fixLaborDescription({ action: "Further diagnosis", component: "the misfire" }), "Diagnose the misfire");
  assert.equal(fixLaborDescription({ action: "Service" }), "Service");
});

test("findingsForCategories returns the picklists for the given areas, all when none", () => {
  const some = findingsForCategories(["Brakes"]);
  assert.deepEqual(some.map(([c]) => c), ["Brakes"]);
  assert.ok(some[0][1].includes("front brake pads worn out"));
  // no categories → offer them all so the builder still works
  const all = findingsForCategories([]);
  assert.equal(all.length, Object.keys(FINDINGS_BY_CATEGORY).length);
});

test("picked findings read naturally in the composed finding", () => {
  const found = ["front brake pads worn out", "front rotors scored or warped"].join("; ");
  const s = composeFinding({ inspected: "the brakes", concern: "Squealing when braking", found, action: "Replace", component: "front brake pads and rotors" });
  assert.equal(
    s,
    "Inspected the brakes because the customer stated: Squealing when braking. Found front brake pads worn out; front rotors scored or warped. Recommend replacing front brake pads and rotors.",
  );
});

test("addFinding appends one per line, no dupes", () => {
  let f = addFinding("", "Inspected the brakes. Found worn pads.");
  f = addFinding(f, "Inspected the A/C. Found low refrigerant.");
  assert.equal(f, "Inspected the brakes. Found worn pads.\nInspected the A/C. Found low refrigerant.");
  assert.equal(addFinding(f, "inspected the brakes. found worn pads."), f); // case-insensitive dupe
});
