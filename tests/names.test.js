import { test } from "node:test";
import assert from "node:assert/strict";
import { staffLabel, realNameError } from "../src/lib/names.js";

test("realNameError blocks symbol/number names but allows real ones", () => {
  assert.equal(realNameError({ first: "John", last: "Smith" }), ""); // fine
  assert.equal(realNameError({ last: "O'Brien" }), ""); // apostrophe ok
  assert.equal(realNameError({ first: "Mary-Jane" }), ""); // hyphen ok
  assert.equal(realNameError({}), ""); // walk-in, no name
  assert.equal(realNameError({ company: "A1 Towing" }), ""); // company may have a number
  assert.ok(realNameError({ first: "." })); // symbol only
  assert.ok(realNameError({ last: "," }));
  assert.ok(realNameError({ first: "'" }));
  assert.ok(realNameError({ first: "123" })); // number only
  assert.ok(realNameError({ first: "John3" })); // no digits in a person's name
  assert.ok(realNameError({ company: "5" })); // company still needs a letter
});

test("staff name formats", () => {
  assert.equal(staffLabel("Sam Garcia", "full"), "Sam Garcia");
  assert.equal(staffLabel("Sam Garcia", "first-initial"), "Sam G.");
  assert.equal(staffLabel("Sam Garcia", "initials"), "S.G.");
  assert.equal(staffLabel("Sam Garcia", "off"), "");
  assert.equal(staffLabel("Sam G.", "first-initial"), "Sam G.");
  assert.equal(staffLabel("Cher", "initials"), "C.");
  assert.equal(staffLabel("Michael Shabo", "initials"), "M.S.");
});
