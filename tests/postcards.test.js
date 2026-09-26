import { test } from "node:test";
import assert from "node:assert/strict";
import { duePostcards, mailingAddress, renderPostcard } from "../src/lib/postcards.js";

const DAY = 86400000;
const now = Date.UTC(2026, 8, 25, 18);
const monthsAgo = (m, plusDays = 0) => {
  const d = new Date(now);
  d.setMonth(d.getMonth() - m);
  return d.getTime() + plusDays * DAY;
};
const addr = { street: "1015 Sumner Pl", city: "El Cajon", state: "ca", zip: "92021" };

test("mailing addresses: complete, real, and never the shop's own", () => {
  assert.deepEqual(mailingAddress({ first: "Ana", last: "Diaz", ...addr }), { name: "Ana Diaz", address_line1: "1015 Sumner Pl", address_city: "El Cajon", address_state: "CA", address_zip: "92021", address_country: "US" });
  assert.equal(mailingAddress({ first: "A", street: "", city: "El Cajon", state: "CA", zip: "92021" }), null);
  assert.equal(mailingAddress({ first: "A", street: "Unknown", city: "El Cajon", state: "CA", zip: "92021" }), null);
  assert.equal(mailingAddress({ first: "A", ...addr, zip: "9202" }), null);
  assert.equal(mailingAddress({ first: "A", street: "830 North 2nd Street", city: "El Cajon", state: "CA", zip: "92021" }, "830 N 2nd St"), null);
  assert.equal(mailingAddress({ ...addr }), null); // no name to address it to
});

const cfg = { reminderMonths: 3, shopAddress: "830 N 2nd St", oilPackages: [{ name: "Valvoline Conventional Oil Change" }] };
const oil = (id, cust, veh, t) => ({ id, customerId: cust, vehicleId: veh, status: "invoiced", invoicedAt: t, lines: [{ kind: "labor", job: "Valvoline Conventional Oil Change", description: "Oil change" }] });

test("this week's batch: sticker dates from a week ago to ~12 days out, one card per customer", () => {
  const customers = {
    a: { id: "a", first: "Ana", last: "Diaz", ...addr },
    b: { id: "b", first: "Bo", last: "Kim", ...addr, mailOptOut: true },
    c: { id: "c", first: "Cy", last: "Ng", street: "830 North 2nd Street", city: "El Cajon", state: "CA", zip: "92021" },
    d: { id: "d", first: "Di", last: "Lo", ...addr },
  };
  const vehicles = { va: { id: "va", customerId: "a", year: 2018, make: "Honda", model: "Civic" }, va2: { id: "va2", customerId: "a", year: 2012, make: "Ford", model: "F-150" }, vb: { id: "vb", customerId: "b" }, vc: { id: "vc", customerId: "c" }, vd: { id: "vd", customerId: "d" } };
  const orders = {
    1: oil("1", "a", "va", monthsAgo(3, 8)), // due in 8 days
    2: oil("2", "a", "va2", monthsAgo(3, 3)), // due in 3 days: same customer, one card naming the sooner car
    3: oil("3", "b", "vb", monthsAgo(3, 5)), // opted out of mail
    4: oil("4", "c", "vc", monthsAgo(3, 5)), // shop's own address as a placeholder
    5: oil("5", "d", "vd", monthsAgo(4)), // due a month ago: too late for this reminder
  };
  const batch = duePostcards({ cfg, customers, vehicles, orders, now });
  assert.equal(batch.length, 1);
  assert.equal(batch[0].to.name, "Ana Diaz");
  assert.equal(batch[0].vars.vehicle, "2012 Ford F-150");
  assert.deepEqual(batch[0].dedupe.sort(), ["card:oil:va2:2", "card:oil:va:1"].sort());
  /* once mailed, never again */
  assert.equal(duePostcards({ cfg, customers, vehicles, orders, mailed: new Set(["card:oil:va2:2", "card:oil:va:1"]), now }).length, 0);
});

test("the card: fits Lob's size limit, scannable QR to the coupon's page, placeholders kept", () => {
  const c = { ...cfg, shopName: "Test Lube", shopPhone: "619-555-0100", website: { slug: "t", domain: "www.testlube.example", cityLine: "El Cajon, CA 92021", offers: { w: {} } }, mail: { couponId: "w" } };
  const { front, back, qrUrl } = renderPostcard(c, { w: { id: "w", code: "WEB20", name: "$20 OFF ANY OIL CHANGE", kind: "amount", value: 20 } }, { logoUrl: "https://x.example/logo.png" });
  assert.equal(qrUrl, "https://www.testlube.example/?offer=web20");
  assert.ok(front.length < 10000 && back.length < 10000);
  assert.ok(back.includes("{first_name}") && back.includes("{due_date}") && back.includes("WEB20"));
  assert.ok(front.includes("$20 OFF") && front.includes("https://x.example/logo.png"));
  assert.ok(back.includes('<path d="M'));
});
