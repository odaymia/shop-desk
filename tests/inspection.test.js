import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_INSPECTION,
  inspectionItems,
  startInspection,
  inspectionSummary,
  inspectionDone,
  inspectionRecommendations,
  normalizeInspection,
  stateLabel,
} from "../src/lib/inspection.js";

test("inspectionItems flattens the template in order with categories", () => {
  const items = inspectionItems(DEFAULT_INSPECTION);
  assert.ok(items.length > 20);
  assert.equal(items[0].category, "Road test & exterior");
  assert.ok(items.every((it) => it.id && it.label && it.category));
  // ids are unique
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
});

test("startInspection seeds every point unmarked", () => {
  const insp = startInspection(DEFAULT_INSPECTION);
  const n = inspectionItems(DEFAULT_INSPECTION).length;
  assert.equal(Object.keys(insp.items).length, n);
  assert.ok(Object.values(insp.items).every((it) => it.status === "" && it.photos.length === 0));
  const s = inspectionSummary(insp);
  assert.equal(s.pending, n);
  assert.equal(inspectionDone(insp), false);
});

test("inspectionSummary counts states, photos, and pending", () => {
  const insp = { items: { a: { status: "good" }, b: { status: "fail", photos: ["p1", "p2"] }, c: { status: "advise" }, d: { status: "" }, e: { status: "na" } } };
  const s = inspectionSummary(insp);
  assert.equal(s.good, 1);
  assert.equal(s.fail, 1);
  assert.equal(s.advise, 1);
  assert.equal(s.na, 1);
  assert.equal(s.pending, 1);
  assert.equal(s.photos, 2);
  assert.equal(s.total, 5);
});

test("inspectionDone true only when nothing is pending", () => {
  assert.equal(inspectionDone({ items: { a: { status: "good" }, b: { status: "na" } } }), true);
  assert.equal(inspectionDone({ items: { a: { status: "good" }, b: { status: "" } } }), false);
  assert.equal(inspectionDone({ items: {} }), false);
});

test("inspectionRecommendations: flagged items only, urgent first, label/price fallback", () => {
  const insp = {
    items: {
      airfilter: { status: "advise" }, // uses template default label+price
      frontbrakes: { status: "fail", recPrice: 320, note: "Metal to metal" }, // template label, tech price
      oil: { status: "good" }, // not flagged
      custom: { status: "advise", recLabel: "Serpentine belt", recPrice: 140 },
    },
  };
  const recs = inspectionRecommendations(insp, DEFAULT_INSPECTION);
  assert.equal(recs.length, 3);
  // urgent (fail) first
  assert.equal(recs[0].id, "frontbrakes");
  assert.equal(recs[0].urgent, true);
  assert.equal(recs[0].label, "Front brake service"); // template default label
  assert.equal(recs[0].price, 320); // tech-entered price
  assert.equal(recs[0].note, "Metal to metal");
  const air = recs.find((r) => r.id === "airfilter");
  assert.equal(air.label, "Engine air filter replacement");
  assert.equal(air.price, 45); // template default price
  const belt = recs.find((r) => r.id === "custom");
  assert.equal(belt.label, "Serpentine belt");
  assert.equal(belt.price, 140);
});

test("normalizeInspection drops empties, keeps ids, coerces price", () => {
  const t = normalizeInspection([
    { name: "Brakes", items: [{ id: "fb", label: "Front pads", recPrice: "200", recLabel: "Front brakes" }, { label: "" }] },
    { name: "", items: [{ label: "orphan" }] },
    { name: "Tires", items: [] },
  ]);
  assert.equal(t.length, 1);
  assert.equal(t[0].name, "Brakes");
  assert.equal(t[0].items.length, 1);
  assert.equal(t[0].items[0].id, "fb");
  assert.equal(t[0].items[0].recPrice, 200);
});

test("stateLabel maps ids to labels", () => {
  assert.equal(stateLabel("fail"), "Needs service");
  assert.equal(stateLabel("good"), "Good");
  assert.equal(stateLabel("nope"), "");
});
