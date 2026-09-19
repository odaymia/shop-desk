import { test } from "node:test";
import assert from "node:assert/strict";
import { composeFinding, fixLaborDescription, addFinding } from "../src/lib/findings.js";

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
});

test("fixLaborDescription is the action + component, or a diagnosis line", () => {
  assert.equal(fixLaborDescription({ action: "Replace", component: "front brake pads" }), "Replace front brake pads");
  assert.equal(fixLaborDescription({ action: "Further diagnosis", component: "the misfire" }), "Diagnose the misfire");
  assert.equal(fixLaborDescription({ action: "Service" }), "Service");
});

test("addFinding appends one per line, no dupes", () => {
  let f = addFinding("", "Inspected the brakes. Found worn pads.");
  f = addFinding(f, "Inspected the A/C. Found low refrigerant.");
  assert.equal(f, "Inspected the brakes. Found worn pads.\nInspected the A/C. Found low refrigerant.");
  assert.equal(addFinding(f, "inspected the brakes. found worn pads."), f); // case-insensitive dupe
});
