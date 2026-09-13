import { test } from "node:test";
import assert from "node:assert/strict";
import { serviceCodes, lineCode } from "../src/lib/serviceCodes.js";

const oilChange = [
  { kind: "labor", job: "Valvoline Full Synthetic Oil Change", description: "Valvoline Full Synthetic Oil Change" },
  { kind: "part", job: "Valvoline Full Synthetic Oil Change", description: "Valvoline Full Synthetic 5W-30" },
  { kind: "part", job: "Valvoline Full Synthetic Oil Change", description: "Oil filter" },
];

test("just an oil change reads OIL", () => {
  assert.deepEqual(serviceCodes({ lines: oilChange }), ["OIL"]);
});

test("oil change plus engine air filter reads OIL, AF", () => {
  const lines = [
    ...oilChange,
    { kind: "part", job: "Engine air filter replacement", description: "Engine air filter" },
    { kind: "labor", job: "Engine air filter replacement", description: "Engine air filter replacement" },
  ];
  assert.deepEqual(serviceCodes({ lines }), ["OIL", "AF"]);
});

test("oil, transmission flush, and coolant flush read OIL, ATF, RAD", () => {
  const lines = [
    ...oilChange,
    { kind: "labor", job: "Transmission fluid exchange", description: "Transmission fluid exchange" },
    { kind: "part", job: "Transmission fluid exchange", description: "Transmission fluid" },
    { kind: "labor", job: "Coolant flush and fill", description: "Coolant flush and fill" },
    { kind: "part", job: "Coolant flush and fill", description: "Coolant" },
  ];
  assert.deepEqual(serviceCodes({ lines }), ["OIL", "ATF", "RAD"]);
});

test("cabin air filter is CAF, not AF — and does not also trip AF", () => {
  assert.equal(lineCode({ kind: "labor", description: "Cabin air filter replacement" }), "CAF");
  assert.deepEqual(serviceCodes({ lines: [{ kind: "part", job: "Cabin air filter replacement", description: "Cabin air filter" }] }), ["CAF"]);
});

test("brake fluid flush is BF; brake pads are BRK", () => {
  assert.equal(lineCode({ kind: "labor", description: "Brake fluid flush" }), "BF");
  assert.equal(lineCode({ kind: "part", job: "Front brake pads replacement", description: "Front brake pads" }), "BRK");
});

test("codes come out in canonical order regardless of line order", () => {
  const lines = [
    { kind: "labor", job: "Coolant flush and fill", description: "Coolant flush and fill" },
    { kind: "labor", job: "Engine air filter replacement", description: "Engine air filter" },
    { kind: "labor", job: "Valvoline Conventional Oil Change", description: "Valvoline Conventional Oil Change" },
  ];
  assert.deepEqual(serviceCodes({ lines }), ["OIL", "AF", "RAD"]);
});

test("tire mount and balance reads TIRE; fees and notes are ignored", () => {
  const lines = [
    { kind: "part", job: "Tires: mount and balance", description: "Mastercraft Stratus 235/65R18" },
    { kind: "labor", job: "Tires: mount and balance", description: "Mount, balance, and tire disposal" },
    { kind: "fee", description: "CA tire recycling fee" },
    { kind: "note", description: "Customer will return for alignment" },
  ];
  assert.deepEqual(serviceCodes({ lines }), ["TIRE"]);
});

test("oil filter alone never counts as a service code", () => {
  assert.equal(lineCode({ kind: "part", description: "Oil filter" }), null);
});

test("differential service reads DIFF", () => {
  assert.equal(lineCode({ kind: "labor", job: "Rear differential fluid service", description: "Gear oil" }), "DIFF");
});

test("an empty ticket has no codes", () => {
  assert.deepEqual(serviceCodes({ lines: [] }), []);
  assert.deepEqual(serviceCodes({}), []);
});

/* Imported (LubeSoft) parts: the category code is authoritative, even when
   the printed description doesn't say "cabin" — the bug behind #6840. */
const parts = {
  lspcaf1: { id: "lspcaf1", description: "AIR FILTER", category: "Filters", ls: { code: "24815", category: "CAF" } },
  lspaf1: { id: "lspaf1", description: "AIR FILTER", category: "Filters", ls: { code: "49010", category: "AF" } },
  lspgo1: { id: "lspgo1", description: "75W90 GL5", category: "Fluids", ls: { code: "GO1", category: "GO" } },
  lspof1: { id: "lspof1", description: "OIL FILTER", category: "Filters", ls: { code: "PH7317", category: "OF" } },
};

test("a coded cabin-filter part reads CAF even when its description says AIR FILTER", () => {
  const order = { lines: [{ kind: "part", partId: "lspcaf1", description: "AIR FILTER" }] };
  assert.deepEqual(serviceCodes(order, parts), ["CAF"]);
});

test("a coded cabin filter is NOT mistaken for AF (the #6840 bug)", () => {
  const order = {
    lines: [
      { kind: "labor", job: "Full service oil change", description: "Full service oil change" },
      { kind: "part", partId: "lspcaf1", description: "AIR FILTER CABIN" },
    ],
  };
  const codes = serviceCodes(order, parts);
  assert.deepEqual(codes, ["OIL", "CAF"]);
  assert.ok(!codes.includes("AF"));
});

test("engine and cabin coded filters on one ticket read AF, CAF distinctly", () => {
  const order = { lines: [{ kind: "part", partId: "lspaf1", description: "AIR FILTER" }, { kind: "part", partId: "lspcaf1", description: "AIR FILTER" }] };
  assert.deepEqual(serviceCodes(order, parts), ["CAF", "AF"]);
});

test("a coded gear-oil part reads DIFF; an oil filter alone still reads nothing", () => {
  assert.equal(lineCode({ kind: "part", partId: "lspgo1", description: "75W90 GL5" }, parts), "DIFF");
  assert.equal(lineCode({ kind: "part", partId: "lspof1", description: "OIL FILTER" }, parts), null);
});

test("without a parts map, classification still falls back to text", () => {
  const order = { lines: [{ kind: "labor", job: "Cabin air filter replacement", description: "Cabin air filter" }] };
  assert.deepEqual(serviceCodes(order), ["CAF"]);
});
