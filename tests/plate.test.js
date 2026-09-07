import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlateResult } from "../src/lib/plate.js";

test("plate result with a quick decode", () => {
  const r = parsePlateResult({
    success: true,
    vin: { vin: "4jgbb8gb9ba648907", year: "2011", make: "Mercedes-Benz", model: "M-Class", trim: "ML 350", engine: "3.5L V6", color: { name: "Silver" } },
  });
  assert.equal(r.vin, "4JGBB8GB9BA648907");
  assert.equal(r.year, 2011);
  assert.equal(r.make, "Mercedes-Benz");
  assert.equal(r.submodel, "ML 350");
  assert.equal(r.color, "Silver");
});

test("plate result with only the VIN in message", () => {
  const r = parsePlateResult({ success: true, message: "1NXBR12E32Z613928" });
  assert.equal(r.vin, "1NXBR12E32Z613928");
  assert.equal(r.make, "");
});

test("plate errors read like plain English", () => {
  assert.throws(() => parsePlateResult({ success: false, message: "No Result Found" }), /No vehicle on file/);
  assert.throws(() => parsePlateResult({ success: false, message: "Not enough credit" }), /out of credit/);
  assert.throws(() => parsePlateResult({ success: false, message: "Incorrect API key" }), /key in Settings/);
  assert.throws(() => parsePlateResult(null), /unreadable/);
  assert.throws(() => parsePlateResult({ success: true, message: "SHORT" }), /full VIN/);
});
