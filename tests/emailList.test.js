import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEmailList, filterEmailList, emailListCsv, validEmail } from "../src/lib/emailList.js";

const DAY = 86400000;
const now = Date.UTC(2026, 8, 25);
const customers = {
  a: { id: "a", first: "Ana", last: "Diaz", email: "Ana@Example.com", phone: "6195550100" },
  a2: { id: "a2", first: "Ana", last: "Diaz", email: "ana@example.com " }, // same person entered twice
  b: { id: "b", first: "Bo", last: "Kim", email: "bo@example", phone: "" }, // not a real address
  c: { id: "c", first: "Cy", last: "Ng", email: "cy@example.com", emailOptOut: true },
  d: { id: "d", first: "Di", email: "", phone: "1" },
  e: { id: "e", first: "Ed", email: "ed@example.com", active: false },
};
const orders = {
  1: { customerId: "a", status: "invoiced", invoicedAt: now - 10 * DAY },
  2: { customerId: "a2", status: "invoiced", invoicedAt: now - 400 * DAY },
  3: { customerId: "c", status: "void", invoicedAt: now - 5 * DAY },
};
const signups = [
  { id: "s1", email: "ANA@example.com", name: "Ana D", source: "FB20", created_at: new Date(now - 3 * DAY).toISOString() },
  { id: "s2", email: "new@example.com", name: "Nia Lopez", source: "", created_at: new Date(now - 2 * DAY).toISOString() },
  { id: "s3", email: "=cmd@example.com", name: "=HYPERLINK(\"x\")", source: "", created_at: new Date(now - DAY).toISOString() },
];

test("one row per address, customers and signups merged", () => {
  const { rows, invalid } = buildEmailList({ customers, orders, signups });
  assert.equal(invalid, 1); // bo@example
  const ana = rows.find((r) => r.email.toLowerCase() === "ana@example.com");
  assert.ok(ana.customer && ana.website);
  assert.deepEqual(ana.customerIds.sort(), ["a", "a2"]);
  assert.equal(ana.visits, 2);
  assert.equal(ana.lastVisit, now - 10 * DAY);
  assert.equal(ana.source, "FB20");
  assert.equal(ana.first, "Ana"); // the customer record's name wins
  const nia = rows.find((r) => r.email === "new@example.com");
  assert.deepEqual([nia.first, nia.last, nia.customer], ["Nia", "Lopez", false]);
  assert.ok(!rows.some((r) => r.email === "ed@example.com")); // retired customer
  assert.ok(rows.find((r) => r.email === "cy@example.com").unsubscribed);
});

test("filters: who and how long since the last visit; unsubscribed only on their own tab", () => {
  const { rows } = buildEmailList({ customers, orders, signups });
  assert.ok(!filterEmailList(rows, {}, now).some((r) => r.unsubscribed));
  assert.deepEqual(filterEmailList(rows, { who: "unsubscribed" }, now).map((r) => r.email), ["cy@example.com"]);
  assert.equal(filterEmailList(rows, { who: "website" }, now).length, 3);
  assert.deepEqual(filterEmailList(rows, { since: "6mo" }, now).map((r) => r.email.toLowerCase()), ["ana@example.com"]);
  assert.equal(filterEmailList(rows, { since: "never" }, now).length, 2);
  assert.equal(filterEmailList(rows, { q: "lopez" }, now).length, 1);
});

test("CSV: import-ready, no unsubscribed people, no spreadsheet formulas", () => {
  const { rows } = buildEmailList({ customers, orders, signups });
  const csv = emailListCsv(rows);
  const lines = csv.trim().split("\r\n");
  assert.equal(lines[0], "Email Address,First Name,Last Name,Phone Number,Tags,Last Visit,Visits,Signed Up");
  assert.ok(!csv.includes("cy@example.com"));
  assert.ok(csv.includes('"customer, website signup, offer FB20"'));
  assert.ok(!/(^|,)"?=/m.test(csv)); // =cmd… and =HYPERLINK are defused
  assert.ok(csv.includes("'=cmd@example.com"));
  assert.ok(validEmail("a.b+c@shop.co") && !validEmail("a@b") && !validEmail("a b@c.com"));
});

test("import a Shopify customer export: consenting people only, nobody twice", async () => {
  const { importCandidates, parseCsv } = await import("../src/lib/emailList.js");
  const csv =
    "﻿Customer ID,First Name,Last Name,Email,Accepts Email Marketing,Default Address Company,Phone\r\n" +
    '1,Ana,Diaz,ana@example.com,yes,"Diaz, Inc.",\r\n' +
    "2,Bo,Kim,bo@example.com,no,,\r\n" +
    "3,Cy,Ng,CY@example.com,yes,,\r\n" +
    "4,Cy,Ng,cy@example.com,yes,,\r\n" +
    "5,Di,,not-an-email,yes,,\r\n" +
    '6,"Eve ""E""",Lo,eve@example.com,yes,"line\nbreak",\r\n';
  assert.equal(parseCsv(csv)[6][5], "line\nbreak");
  const { add, skipped } = importCandidates(csv, ["ana@example.com"]);
  assert.deepEqual(add, [
    { email: "CY@example.com", name: "Cy Ng" },
    { email: "eve@example.com", name: 'Eve "E" Lo' },
  ]);
  assert.deepEqual(skipped, { noConsent: 1, invalid: 1, already: 1, duplicate: 1 });
  assert.throws(() => importCandidates("Name,Phone\nA,1\n", []), /no Email column/);
});
