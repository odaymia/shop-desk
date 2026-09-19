import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeature } from "../src/lib/addressLookup.js";

test("parseFeature pulls street, city, 2-letter state, and ZIP from a Photon house feature", () => {
  const a = parseFeature({
    properties: {
      housenumber: "1420",
      street: "Adams Avenue",
      city: "San Diego",
      state: "California",
      postcode: "92116",
      countrycode: "US",
    },
  });
  assert.equal(a.street, "1420 Adams Avenue");
  assert.equal(a.city, "San Diego");
  assert.equal(a.state, "CA"); // full state name mapped to the postal code
  assert.equal(a.zip, "92116");
  assert.equal(a.country, "US");
  assert.equal(a.label, "1420 Adams Avenue, San Diego, CA 92116");
});

test("parseFeature falls back to name when there's no street, and town/village for city", () => {
  const a = parseFeature({ properties: { name: "Main Street", village: "Julian", state: "CA", postcode: "92036", countrycode: "US" } });
  assert.equal(a.street, "Main Street");
  assert.equal(a.city, "Julian");
  assert.equal(a.state, "CA");
});

test("parseFeature is safe on empty input and leaves an unknown state blank", () => {
  assert.deepEqual(parseFeature(null), { street: "", city: "", state: "", zip: "", country: "", label: "" });
  const a = parseFeature({ properties: { housenumber: "5", street: "Rue de Rivoli", city: "Paris", state: "Île-de-France", countrycode: "FR" } });
  assert.equal(a.state, ""); // not a US state
  assert.equal(a.country, "FR");
});
