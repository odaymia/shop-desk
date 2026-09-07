import { test } from "node:test";
import assert from "node:assert/strict";
import { staffLabel } from "../src/lib/names.js";

test("staff name formats", () => {
  assert.equal(staffLabel("Sam Garcia", "full"), "Sam Garcia");
  assert.equal(staffLabel("Sam Garcia", "first-initial"), "Sam G.");
  assert.equal(staffLabel("Sam Garcia", "initials"), "S.G.");
  assert.equal(staffLabel("Sam Garcia", "off"), "");
  assert.equal(staffLabel("Sam G.", "first-initial"), "Sam G.");
  assert.equal(staffLabel("Cher", "initials"), "C.");
  assert.equal(staffLabel("Michael Shabo", "initials"), "M.S.");
});
