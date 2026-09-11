import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CHECKLIST, startChecklist, replacedOnTicket, cycle, withDepthDefault, checklistSummary, optionsOf, normalizeChecklist, priorChecklist } from "../src/lib/checklist.js";
import { DEFAULT_OIL_PACKAGES, oilPackageLines } from "../src/lib/oilchange.js";

const byId = (items, id) => items.find((x) => x.id === id);

test("an oil change on the ticket marks engine oil and the filter Replaced, the rest start at their defaults", () => {
  let n = 0;
  const lines = oilPackageLines(DEFAULT_OIL_PACKAGES[0], 5, null, null, () => `L${++n}`);
  const items = startChecklist(DEFAULT_CHECKLIST, lines, null);
  assert.equal(items.length, DEFAULT_CHECKLIST.length);
  assert.equal(byId(items, "oil").value, "Replaced");
  assert.equal(byId(items, "oil").auto, true);
  assert.equal(byId(items, "oilFilter").value, "Replaced");
  assert.equal(byId(items, "airFilter").value, "Checked OK");
  assert.equal(byId(items, "rearDiff").value, "At your request");
  assert.equal(byId(items, "tirePsi").value, "F35 R35");
  assert.equal(byId(items, "lfDepth").value, "");
});

test("a cabin filter line marks the cabin filter, not the engine air filter, and the other way round", () => {
  const cabin = [{ kind: "part", description: "Cabin air filter", job: "" }];
  const engine = [{ kind: "part", description: "Engine air filter", job: "Air filter replacement" }];
  assert.equal(replacedOnTicket(byId(DEFAULT_CHECKLIST, "cabinFilter"), cabin), true);
  assert.equal(replacedOnTicket(byId(DEFAULT_CHECKLIST, "airFilter"), cabin), false);
  assert.equal(replacedOnTicket(byId(DEFAULT_CHECKLIST, "airFilter"), engine), true);
  assert.equal(replacedOnTicket(byId(DEFAULT_CHECKLIST, "cabinFilter"), engine), false);
  /* notes never count */
  assert.equal(replacedOnTicket(byId(DEFAULT_CHECKLIST, "oilFilter"), [{ kind: "note", description: "customer asked about the oil filter" }]), false);
});

test("nothing on the ticket leaves a blank checklist at defaults, and the empty auto never matches", () => {
  const items = startChecklist(DEFAULT_CHECKLIST, [], null);
  assert.ok(items.every((it) => !it.auto));
  assert.equal(byId(items, "washer").value, "Added");
  assert.equal(replacedOnTicket(byId(DEFAULT_CHECKLIST, "washer"), [{ kind: "part", description: "anything" }]), false);
});

test("tire pressure comes back from the car's last visit; choices do not", () => {
  const prior = [
    { id: "tirePsi", value: "F33 R36" },
    { id: "airFilter", value: "Replaced" },
  ];
  const items = startChecklist(DEFAULT_CHECKLIST, [], prior);
  assert.equal(byId(items, "tirePsi").value, "F33 R36");
  assert.equal(byId(items, "airFilter").value, "Checked OK");
});

test("priorChecklist is the car's latest filled one, skipping deleted and the ticket itself", () => {
  const orders = {
    a: { id: "a", vehicleId: "v1", createdAt: 1, checklist: { items: [{ id: "tirePsi", value: "old" }] } },
    b: { id: "b", vehicleId: "v1", createdAt: 2, invoicedAt: 3, checklist: { items: [{ id: "tirePsi", value: "new" }] } },
    c: { id: "c", vehicleId: "v1", createdAt: 9, status: "deleted", checklist: { items: [{ id: "tirePsi", value: "gone" }] } },
    d: { id: "d", vehicleId: "v1", createdAt: 10, checklist: { items: [{ id: "tirePsi", value: "self" }] } },
  };
  assert.equal(priorChecklist(orders, "v1", "d")[0].value, "new");
  assert.equal(priorChecklist(orders, "v2", "d"), null);
});

test("space cycles through the choices and wraps; number keys map onto the same list", () => {
  const opts = optionsOf(byId(DEFAULT_CHECKLIST, "wipers"), DEFAULT_CHECKLIST);
  assert.deepEqual(opts, ["Checked OK", "Replaced", "At your request"]);
  assert.equal(cycle(opts, "Checked OK"), "Replaced");
  assert.equal(cycle(opts, "At your request"), "Checked OK");
  assert.equal(cycle(opts, "Checked OK", -1), "At your request");
  assert.equal(cycle(opts, "something else"), "Checked OK");
  /* Replaced is always offered so an auto-marked item can be set back */
  assert.ok(optionsOf({ id: "x", options: ["Full", "Added"] }, []).includes("Replaced"));
});

test("stepping onto a blank tire depth copies the last one entered", () => {
  let items = startChecklist(DEFAULT_CHECKLIST, [], null);
  const lf = items.findIndex((x) => x.id === "lfDepth");
  assert.equal(withDepthDefault(items, lf), items); // nothing entered yet
  items = items.map((x) => (x.id === "lfDepth" ? { ...x, value: "8" } : x));
  items = withDepthDefault(items, lf + 1);
  assert.equal(byId(items, "rfDepth").value, "8");
  /* an entered value is never overwritten */
  items = items.map((x) => (x.id === "lrDepth" ? { ...x, value: "6" } : x));
  assert.equal(byId(withDepthDefault(items, lf + 2), "lrDepth").value, "6");
});

test("the summary prints depths in 32nds and leaves blanks blank", () => {
  const s = checklistSummary([
    { id: "lfDepth", label: "Front driver side tire depth", kind: "depth", value: "8" },
    { id: "rrDepth", label: "Rear passenger side tire depth", kind: "depth", value: "" },
    { id: "oil", label: "Engine oil", kind: "choice", value: "Replaced" },
  ]);
  assert.deepEqual(s, [
    { label: "Front driver side tire depth", text: "8/32nds" },
    { label: "Rear passenger side tire depth", text: "" },
    { label: "Engine oil", text: "Replaced" },
  ]);
});

test("settings rows normalize: comma options, blank labels dropped, text items lose auto", () => {
  const rows = normalizeChecklist([
    { id: "a", label: " Belts ", kind: "choice", options: "Checked OK, Cracked , Replaced", value: "Checked OK", auto: "belt" },
    { label: "", options: "x" },
    { id: "b", label: "Battery volts", kind: "text", value: "12.6", auto: "battery" },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].options, ["Checked OK", "Cracked", "Replaced"]);
  assert.equal(rows[0].label, "Belts");
  assert.equal(rows[1].auto, "");
  assert.deepEqual(rows[1].options, []);
});
