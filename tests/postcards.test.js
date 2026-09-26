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

test("the series: 2nd and 3rd cards only for cars that haven't been back, each after the one before", async () => {
  const { stepKey, mailOf } = await import("../src/lib/postcards.js");
  const customers = { a: { id: "a", first: "Ana", last: "Diaz", ...addr } };
  const vehicles = { va: { id: "va", customerId: "a", year: 2018, make: "Honda", model: "Civic" } };
  const orders = { 1: oil("1", "a", "va", monthsAgo(3, -25)) }; // sticker date was 25 days ago
  const series = { ...cfg, mail: { steps: [{}, { on: true, afterDays: 21 }, { on: true, afterDays: 42 }] } };
  /* card 1 never went out: no card 2 either */
  assert.equal(duePostcards({ cfg: series, customers, vehicles, orders, now }).length, 0);
  /* card 1 went out: card 2 is due now (25 days after, window 21–35) */
  const b2 = duePostcards({ cfg: series, customers, vehicles, orders, mailed: new Set([stepKey("va", "1", 0)]), now });
  assert.deepEqual(b2.map((b) => [b.step, b.dedupe[0]]), [[1, "card:oil:va:1:s2"]]);
  /* card 2 is off: nothing */
  const off = { ...cfg, mail: { steps: [{}, { on: false, afterDays: 21 }, { on: true, afterDays: 42 }] } };
  assert.equal(duePostcards({ cfg: off, customers, vehicles, orders, mailed: new Set([stepKey("va", "1", 0)]), now }).length, 0);
  /* they came back for an oil change: the old series stops, a new one starts from card 1 later */
  const back = { ...orders, 2: oil("2", "a", "va", now - 2 * DAY) };
  assert.equal(duePostcards({ cfg: series, customers, vehicles, orders: back, mailed: new Set([stepKey("va", "1", 0)]), now }).length, 0);
  /* old one-card settings carry into card 1 */
  const old = mailOf({ mail: { headline: "Old", couponId: "x" } });
  assert.equal(old.steps[0].headline, "Old");
  assert.deepEqual(old.steps[0].couponIds, ["x"]);
});

test("a card with several coupons: all codes on the back, the first on the front, still under Lob's limit", () => {
  const coupons = {
    a: { id: "a", code: "OIL10", name: "$10 OFF ANY OIL CHANGE", kind: "amount", value: 10 },
    b: { id: "b", code: "FLUID10", name: "$10 OFF ANY FLUID EXCHANGE SERVICE", kind: "amount", value: 10 },
    c: { id: "c", code: "BRAKE20", name: "$20 OFF ANY BRAKE SERVICE", kind: "amount", value: 20, endsAt: "2026-12-31" },
  };
  const c = { ...cfg, shopName: "T", website: { cityLine: "El Cajon, CA 92021" }, mail: { photo: "https://cdn.example/storefront.jpg", steps: [{ couponIds: ["a", "b", "c"] }] } };
  const { front, back } = renderPostcard(c, coupons, {});
  for (const code of ["OIL10", "FLUID10", "BRAKE20"]) assert.ok(back.includes(code));
  assert.ok(back.includes("Ends 2026-12-31"));
  assert.ok(front.includes("$10 OFF") && front.includes("https://cdn.example/storefront.jpg"));
  assert.ok(front.length < 10000 && back.length < 10000);
});

test("oil type from the last oil change, the way the desk and LubeSoft history word it", async () => {
  const { oilTypeOf, couponIdsFor } = await import("../src/lib/postcards.js");
  const o = (...d) => ({ lines: d.map((x) => ({ kind: "part", job: "Full service oil change", description: x })) });
  assert.equal(oilTypeOf(o("Full Service Oil Change", "Synthetic Oil Charge", "Valv Synpower Sae 0W20 (included)")), "synthetic");
  assert.equal(oilTypeOf(o("Full Service Oil Change", "Valv Prem Conv Sae 5W30 (included)")), "conventional");
  assert.equal(oilTypeOf(o("Synthetic Blend Charge", "Valv Maxlife Sae 5W30 (included)")), "blend");
  assert.equal(oilTypeOf(o("Customer'S Motor Oil (included)", "Customer'S Oil Credit")), "own");
  /* Max-Life ATF on the same ticket is transmission fluid, not a blend */
  assert.equal(oilTypeOf(o("Valv Prem Conv Sae 5W20 (included)", "Valvoline Max-Life Atf (included)")), "conventional");
  /* extra quarts and coupons don't decide it */
  assert.equal(oilTypeOf(o("Valv Prem Conv Sae 5W30 (included)", "Extra oil over 5 qt — Valv Synpower Sae 0W20", "Coupon 10MGR")), "conventional");
  assert.equal(oilTypeOf({ lines: [{ kind: "labor", job: "Valvoline MaxLife High Mileage Synthetic Blend Oil Change", description: "x" }] }), "blend");
  assert.equal(oilTypeOf({ lines: [{ kind: "labor", job: "Valvoline Full Synthetic Oil Change", description: "x" }] }), "synthetic");
  assert.equal(oilTypeOf(o("Vo84 Oil Filter")), "");
  const step = { couponIds: ["any"], byOil: { synthetic: ["syn", "fluid"], blend: [], conventional: ["conv", "syn"] } };
  assert.deepEqual(couponIdsFor(step, "synthetic"), ["syn", "fluid"]);
  assert.deepEqual(couponIdsFor(step, "conventional"), ["conv", "syn"]);
  assert.deepEqual(couponIdsFor(step, "blend"), ["any"]); // none set for blend: the regular ones
  assert.deepEqual(couponIdsFor(step, "own"), ["any"]);
});

test("each card in a batch knows its car's oil, and gets that oil's coupons", () => {
  const customers = { a: { id: "a", first: "Ana", last: "Diaz", ...addr } };
  const vehicles = { va: { id: "va", customerId: "a", year: 2018, make: "Honda", model: "Civic" } };
  const syn = { id: "1", customerId: "a", vehicleId: "va", status: "invoiced", invoicedAt: monthsAgo(3, 5), lines: [{ kind: "part", job: "Full service oil change", description: "Valv Synpower Sae 0W20 (included)" }] };
  const [card] = duePostcards({ cfg, customers, vehicles, orders: { 1: syn }, now });
  assert.equal(card.oil, "synthetic");
  const coupons = { s: { id: "s", code: "SYN15", name: "$15 OFF FULL SYNTHETIC", kind: "amount", value: 15 }, g: { id: "g", code: "ANY5", name: "$5 OFF", kind: "amount", value: 5 } };
  const c2 = { ...cfg, website: { cityLine: "El Cajon, CA 92021" }, mail: { steps: [{ couponIds: ["g"], byOil: { synthetic: ["s"] } }] } };
  assert.ok(renderPostcard(c2, coupons, {}, 0, card.oil).back.includes("SYN15"));
  assert.ok(renderPostcard(c2, coupons, {}, 0, "conventional").back.includes("ANY5"));
});
