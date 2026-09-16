import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRevision, withRevision, revisionCount, revisionDelta } from "../src/lib/revisions.js";

const cfg = { taxRate: 0, partsTaxable: true, laborTaxable: false };
const order = {
  status: "estimate",
  concern: "Brakes grinding",
  lines: [{ kind: "labor", description: "Replace front pads", hours: 1, rate: 170 }],
};

test("makeRevision snapshots the lines, concern, status, and totals", () => {
  const r = makeRevision(order, cfg, null, "First quote");
  assert.equal(r.note, "First quote");
  assert.equal(r.status, "estimate");
  assert.equal(r.concern, "Brakes grinding");
  assert.equal(r.total, 170);
  assert.equal(r.lines.length, 1);
  assert.ok(r.id && r.at);
});

test("the snapshot is a deep copy — later edits don't change it", () => {
  const r = makeRevision(order, cfg, null, "quote");
  order.lines[0].rate = 999;
  assert.equal(r.lines[0].rate, 170); // unchanged
  order.lines[0].rate = 170; // restore
});

test("withRevision appends and revisionCount tracks", () => {
  let o = { ...order, revisions: [] };
  assert.equal(revisionCount(o), 0);
  o = withRevision(o, makeRevision(o, cfg, null, "v1"));
  o = withRevision(o, makeRevision(o, cfg, null, "v2"));
  assert.equal(revisionCount(o), 2);
  assert.equal(o.revisions[0].note, "v1");
});

test("revisionDelta reports added lines and total change", () => {
  const a = { total: 170, lines: [{}] };
  const b = { total: 320, lines: [{}, {}] };
  const d = revisionDelta(a, b);
  assert.equal(d.addedLines, 1);
  assert.equal(d.removedLines, 0);
  assert.equal(d.totalChange, 150);
});
