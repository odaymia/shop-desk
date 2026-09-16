import { test } from "node:test";
import assert from "node:assert/strict";
import { addSymptom, symptomGroups, DEFAULT_SYMPTOMS } from "../src/lib/symptoms.js";

test("addSymptom appends one per line and skips duplicates", () => {
  let c = "";
  c = addSymptom(c, "Check engine light on");
  assert.equal(c, "Check engine light on");
  c = addSymptom(c, "A/C not cold");
  assert.equal(c, "Check engine light on\nA/C not cold");
  c = addSymptom(c, "check engine light ON"); // case-insensitive dupe
  assert.equal(c, "Check engine light on\nA/C not cold");
});

test("addSymptom preserves what the writer already typed", () => {
  const c = addSymptom("Customer says it started yesterday", "Rough idle");
  assert.equal(c, "Customer says it started yesterday\nRough idle");
});

test("symptomGroups includes the defaults and merges the shop's own on top", () => {
  const base = symptomGroups({});
  assert.equal(base.length, DEFAULT_SYMPTOMS.length);
  const withOwn = symptomGroups({ symptoms: ["Here for the Groupon oil change"] });
  assert.equal(withOwn[0][0], "Shop");
  assert.deepEqual(withOwn[0][1], ["Here for the Groupon oil change"]);
});
