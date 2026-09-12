import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAuthText, authCounts } from "../src/lib/authForm.js";

test("checkboxes and underscore blanks become tokens; text is preserved", () => {
  const txt = "Mark one: [ ] SAVE parts   [ ] Do NOT save. Reassembled within ____ days.";
  const toks = parseAuthText(txt);
  const checks = toks.filter((t) => t.type === "check");
  const blanks = toks.filter((t) => t.type === "blank");
  assert.equal(checks.length, 2);
  assert.equal(blanks.length, 1);
  assert.equal(checks[0].i, 0);
  assert.equal(checks[1].i, 1);
  assert.equal(blanks[0].i, 0);
  // reassembling the text tokens gives back the words (markers aside)
  const words = toks.filter((t) => t.type === "text").map((t) => t.text).join("");
  assert.ok(words.includes("SAVE parts"));
  assert.ok(words.includes("Do NOT save"));
  assert.ok(words.includes("days."));
});

test("plain text with no fields is a single text token", () => {
  const toks = parseAuthText("Just a warranty statement.");
  assert.equal(toks.length, 1);
  assert.equal(toks[0].type, "text");
  assert.deepEqual(authCounts("no fields here"), { checks: 0, blanks: 0 });
});

test("empty or missing text is handled", () => {
  assert.deepEqual(parseAuthText(""), []);
  assert.deepEqual(parseAuthText(null), []);
});
