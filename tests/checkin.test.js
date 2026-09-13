import { test } from "node:test";
import assert from "node:assert/strict";
import { matchExistingCustomer, customerToForm } from "../src/lib/checkin.js";

const customers = {
  a: { id: "a", first: "Jane", last: "Doe", phone: "(619) 555-0142", email: "jane@example.com", active: true },
  b: { id: "b", first: "John", last: "Doe", phone: "619-555-0142", active: true }, // same house phone, different person
  c: { id: "c", first: "Mary", last: "Smith", phone: "", phone2: "6195550199", active: true },
  d: { id: "d", first: "Old", last: "Account", phone: "6195550100", active: false },
};

test("no match for an unseen phone number", () => {
  assert.equal(matchExistingCustomer(customers, { first: "New", last: "Person", phone: "619-555-7777" }), null);
});

test("exact name + phone matches, ignoring phone formatting", () => {
  const m = matchExistingCustomer(customers, { first: "jane", last: "doe", phone: "16195550142" });
  assert.equal(m && m.id, "a");
});

test("same phone but a different first name is treated as a new person (household)", () => {
  const m = matchExistingCustomer(customers, { first: "Janet", last: "Doe", phone: "(619) 555-0142" });
  assert.equal(m, null);
});

test("resolves to the right household member when both names are given", () => {
  const m = matchExistingCustomer(customers, { first: "John", last: "Doe", phone: "6195550142" });
  assert.equal(m && m.id, "b");
});

test("matches on the second phone number on file", () => {
  const m = matchExistingCustomer(customers, { first: "Mary", last: "Smith", phone: "(619) 555-0199" });
  assert.equal(m && m.id, "c");
});

test("only one name part given: that part must agree", () => {
  assert.equal(matchExistingCustomer(customers, { first: "", last: "Smith", phone: "6195550199" }).id, "c");
  assert.equal(matchExistingCustomer(customers, { first: "", last: "Jones", phone: "6195550199" }), null);
});

test("inactive customers are never matched", () => {
  assert.equal(matchExistingCustomer(customers, { first: "Old", last: "Account", phone: "6195550100" }), null);
});

test("too-short phone numbers never match", () => {
  assert.equal(matchExistingCustomer(customers, { first: "Jane", last: "Doe", phone: "0142" }), null);
});

test("customerToForm fills defaults and never yields undefined fields", () => {
  const f = customerToForm({ first: "Jane", phone: "6195550142" });
  assert.equal(f.state, "CA");
  assert.equal(f.email, "");
  assert.equal(f.last, "");
});
