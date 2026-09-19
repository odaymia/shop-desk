import { test } from "node:test";
import assert from "node:assert/strict";
import { composeFinding, fixLaborDescription, addFinding, findingsForCategories, oxfordJoin, lowerFirst, FINDINGS_BY_CATEGORY } from "../src/lib/findings.js";

test("oxfordJoin and lowerFirst read as prose", () => {
  assert.equal(oxfordJoin(["a"]), "a");
  assert.equal(oxfordJoin(["a", "b"]), "a and b");
  assert.equal(oxfordJoin(["a", "b", "c"]), "a, b, and c");
  assert.equal(lowerFirst("Grinding noise"), "grinding noise");
  assert.equal(lowerFirst("A/C not cold"), "A/C not cold"); // acronym/code preserved
  assert.equal(lowerFirst("TPMS light on"), "TPMS light on");
});

test("composeFinding writes clean prose tied to the concern", () => {
  const s = composeFinding({
    inspected: "the front brakes",
    concern: oxfordJoin(["grinding noise when braking", "brakes feel soft or spongy"]),
    found: oxfordJoin(["front brake pads worn out", "front rotors scored or warped"]),
    action: "Replace",
    component: "front brake pads and rotors",
  });
  assert.equal(
    s,
    "Inspected the front brakes for the customer's concern of grinding noise when braking and brakes feel soft or spongy. Found front brake pads worn out and front rotors scored or warped. Recommend replacing front brake pads and rotors.",
  );
});

test("composeFinding handles 'further diagnosis' and normalizes stray separators", () => {
  const s = composeFinding({ inspected: "the engine", concern: "check engine light on; rough idle", found: "a stored misfire code", action: "Further diagnosis" });
  assert.equal(s, "Inspected the engine for the customer's concern of check engine light on, rough idle. Found a stored misfire code. Recommend further diagnosis.");
});

test("composeFinding still reads well when half-filled", () => {
  assert.equal(composeFinding({ found: "a coolant leak at the water pump" }), "Inspected the vehicle. Found a coolant leak at the water pump.");
  assert.equal(composeFinding({}), "Inspected the vehicle.");
  // action but no component → the noun form, so it isn't a dangling verb
  assert.equal(composeFinding({ found: "front pads worn", action: "Replace" }), "Inspected the vehicle. Found front pads worn. Recommend replacement.");
});

test("picked findings read naturally in the composed finding", () => {
  const found = oxfordJoin(["front brake pads worn out", "front rotors scored or warped"]);
  const s = composeFinding({ inspected: "the brakes", concern: lowerFirst("Squealing when braking"), found, action: "Replace", component: "front brake pads and rotors" });
  assert.equal(
    s,
    "Inspected the brakes for the customer's concern of squealing when braking. Found front brake pads worn out and front rotors scored or warped. Recommend replacing front brake pads and rotors.",
  );
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

test("addFinding appends one per line, no dupes", () => {
  let f = addFinding("", "Inspected the brakes. Found worn pads.");
  f = addFinding(f, "Inspected the A/C. Found low refrigerant.");
  assert.equal(f, "Inspected the brakes. Found worn pads.\nInspected the A/C. Found low refrigerant.");
  assert.equal(addFinding(f, "inspected the brakes. found worn pads."), f); // case-insensitive dupe
});
