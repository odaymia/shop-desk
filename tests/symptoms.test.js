import { test } from "node:test";
import assert from "node:assert/strict";
import { addSymptom, symptomGroups, DEFAULT_SYMPTOMS, composeConcern, parseConcern, allSymptomItems } from "../src/lib/symptoms.js";

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

test("composeConcern lists each concern on its own line, de-duped, order kept", () => {
  assert.equal(composeConcern(["Check engine light on", "A/C not cold"], ""), "Check engine light on\nA/C not cold");
  assert.equal(composeConcern(["Oil leak", "oil leak"], "Also a rattle\nOil leak"), "Oil leak\nAlso a rattle");
  assert.equal(composeConcern([], ""), "");
});

test("parseConcern splits a saved concern into known symptoms and free text", () => {
  const { selected, extra } = parseConcern("Check engine light on\nWeird noise on the freeway\nA/C not cold", {});
  assert.deepEqual(selected, ["Check engine light on", "A/C not cold"]);
  assert.equal(extra, "Weird noise on the freeway");
});

test("parseConcern matches the shop's own custom symptoms, and round-trips with compose", () => {
  const cfg = { symptoms: ["Fleet inspection — monthly"] };
  assert.ok(allSymptomItems(cfg).includes("Fleet inspection — monthly"));
  const built = composeConcern(["Fleet inspection — monthly", "Battery keeps dying"], "Only when cold");
  const { selected, extra } = parseConcern(built, cfg);
  assert.deepEqual(selected, ["Fleet inspection — monthly", "Battery keeps dying"]);
  assert.equal(extra, "Only when cold");
});
