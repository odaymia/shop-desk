import { test } from "node:test";
import assert from "node:assert/strict";
import { intervalText, autoHighlights, splitHighlight, parseHoursText, hoursRows, hoursText, openStatus, siteStats, quoteVehicles, packagePrice, packageKind, carKind, packagesFor, sitePayload, normalizeWebsite, slugify, validateRequest } from "../src/lib/website.js";
import { renderSite, defaultTagline } from "../src/lib/siteRender.js";
import { serviceContent } from "../src/lib/serviceContent.js";

const WEEK = parseHoursText("MON-FRI 8-6 SAT 8-5");

test("free-text hours become a week, Sunday first", () => {
  assert.deepEqual(WEEK[0], { closed: true, open: "", close: "" });
  assert.deepEqual(WEEK[1], { closed: false, open: "08:00", close: "18:00" });
  assert.deepEqual(WEEK[5], { closed: false, open: "08:00", close: "18:00" });
  assert.deepEqual(WEEK[6], { closed: false, open: "08:00", close: "17:00" });
  const b = parseHoursText("Mon–Fri 7:30am–5:30pm, Sat 9am to 1pm");
  assert.deepEqual(b[3], { closed: false, open: "07:30", close: "17:30" });
  assert.deepEqual(b[6], { closed: false, open: "09:00", close: "13:00" });
  assert.ok(parseHoursText("call us").every((d) => d.closed));
});

test("hours table merges identical days, Monday first", () => {
  assert.deepEqual(hoursRows(WEEK), [
    { days: "Mon – Fri", text: "8am – 6pm" },
    { days: "Sat", text: "8am – 5pm" },
    { days: "Sun", text: "Closed" },
  ]);
  assert.equal(hoursText(WEEK), "Mon – Fri 8am – 6pm, Sat 8am – 5pm");
});

test("open now, and when it opens next", () => {
  assert.equal(openStatus(WEEK, { day: 2, minutes: 9 * 60 }).open, true);
  assert.equal(openStatus(WEEK, { day: 2, minutes: 9 * 60 }).text, "Open now · until 6pm");
  assert.equal(openStatus(WEEK, { day: 2, minutes: 7 * 60 }).text, "Closed · opens today at 8am");
  assert.equal(openStatus(WEEK, { day: 2, minutes: 18 * 60 }).text, "Closed · opens tomorrow at 8am");
  assert.equal(openStatus(WEEK, { day: 6, minutes: 17 * 60 }).text, "Closed · opens Monday at 8am");
  assert.equal(openStatus(WEEK, { day: 0, minutes: 12 * 60 }).text, "Closed · opens tomorrow at 8am");
});

test("history stats count invoices only and round down", () => {
  const orders = {};
  for (let i = 0; i < 1234; i++) orders[i] = { status: "invoiced", invoicedAt: Date.UTC(2016 + (i % 3), 5, 1) };
  orders.x = { status: "void", invoicedAt: Date.UTC(2010, 0, 1) };
  orders.y = { status: "estimate" };
  assert.deepEqual(siteStats(orders), { sinceYear: 2016, services: 1200, plus: true });
});

test("oil quote: same as the ticket — extra oil by the tenth of a quart", () => {
  const pkg = { price: 54.99, quarts: 5, extraQuart: 5.99 };
  assert.equal(packagePrice(pkg, 4.4), 54.99);
  assert.equal(packagePrice(pkg, 5), 54.99);
  assert.equal(packagePrice(pkg, 5.7), 59.18); // 54.99 + 0.7 × 5.99
  assert.equal(packagePrice(pkg, 8), 72.96);
});

test("diesel and Euro packages only go to cars that take them", () => {
  const kinds = ["", "", "e", "d"].map((k, i) => packageKind({ name: ["Conventional", "Full Synthetic", "Euro Full Synthetic", "Diesel Oil Change"][i] }));
  assert.deepEqual(kinds, ["", "", "e", "d"]);
  assert.equal(carKind("Honda", "1.5L 4-cyl", "0W-20", 3.7), "");
  assert.equal(carKind("BMW", "3.0L 6-cyl", "5W-30", 6.9), "e");
  assert.equal(carKind("Ford", "7.3L 8-cyl", "15W-40", 15), "d");
  assert.equal(carKind("Ram", "6.7L 6-cyl", "5W-40", 12), "d");
  assert.deepEqual(packagesFor(kinds, ""), [0, 1]);
  assert.deepEqual(packagesFor(kinds, "e"), [0, 1, 2]);
  assert.deepEqual(packagesFor(kinds, "d"), [3]);
  assert.deepEqual(packagesFor(["", ""], "d"), [0, 1]); // no diesel package: show them all, not nothing
});

test("quote vehicles: the shop's own specs, deduped, capacity required", () => {
  const rows = quoteVehicles({
    a: { year: 2018, make: "Honda", model: "Civic", engine: "2.0L 4-cyl", oilViscosity: "0W-20", oilCapacityQt: 4.4 },
    b: { year: 2018, make: "Honda", model: "Civic", engine: "2.0L 4-cyl", oilViscosity: "0W-20", oilCapacityQt: 4.4 },
    c: { year: 2018, make: "Honda", model: "Fit", engine: "1.5L", oilCapacityQt: "" },
    d: { year: 2019, make: "Ford", model: "F-250", engine: "6.7L", oilViscosity: "15W-40", oilCapacityQt: 13, active: false },
  });
  assert.deepEqual(rows, [[2018, "Honda", "Civic", "2.0L 4-cyl", "0W-20", 4.4, ""]]);
});

const cfg = {
  shopName: "Test Lube & Tire",
  shopPhone: "619-555-0100",
  shopAddress: "1 Main St",
  hours: "Mon-Fri 8-6",
  partsTaxable: true,
  laborRate: 100,
  taxRate: 8,
  serviceMenu: [{ id: "oil", name: "Oil change", oil: true }, { id: "brakes", name: "Brakes", category: "Brakes" }],
  oilPackages: [
    { id: "conv", name: "Conventional Oil Change", price: 49.99, quarts: 5, extraQuart: 5 },
    { id: "own", name: "Customers Oil", price: 30, quarts: 5, extraQuart: 0 },
  ],
  website: { enabled: true, slug: "test", couponIds: ["c1"], hiddenPackages: ["own"] },
};
const coupons = {
  c1: { id: "c1", code: "SAVE10", name: "$10 off", kind: "amount", value: 10, active: true },
  c2: { id: "c2", code: "FREE", name: "100% OFF TOTAL BILL", kind: "percent", value: 100, active: true },
  c3: { id: "c3", code: "OLD", kind: "amount", value: 5, active: true, endsAt: "2020-01-01" },
};

test("payload: only ticked coupons, no hidden packages, nothing private", () => {
  const p = sitePayload({ cfg: { ...cfg, website: { ...cfg.website, couponIds: ["c1", "c3"] } }, jobs: {}, parts: {}, coupons, orders: {}, specs: {}, today: "2026-09-25" });
  assert.deepEqual(p.deals.map((d) => d.code), ["SAVE10"]); // FREE never ticked, OLD expired
  assert.deepEqual(p.oilPackages.map((k) => k.name), ["Conventional Oil Change"]);
  assert.equal(p.services[0].from, 49.99);
  assert.equal(p.services[1].from, null);
  const json = JSON.stringify(p);
  assert.ok(!json.includes("laborRate") && !json.includes("FREE") && !json.includes("plateApiKey"));
});

test("payload: prices off hides packages, prices and the quote", () => {
  const specs = { a: { year: 2018, make: "Honda", model: "Civic", engine: "2.0L", oilCapacityQt: 4.4 } };
  const on = sitePayload({ cfg, jobs: {}, parts: {}, coupons, orders: {}, specs, today: "2026-09-25" });
  assert.equal(on.vehicles.length, 1);
  const off = sitePayload({ cfg: { ...cfg, website: { ...cfg.website, showPrices: false } }, jobs: {}, parts: {}, coupons, orders: {}, specs, today: "2026-09-25" });
  assert.equal(off.oilPackages.length, 0);
  assert.equal(off.vehicles.length, 0);
  assert.equal(off.services[0].from, null);
});

test("the page escapes everything the shop typed", () => {
  const p = sitePayload({ cfg: { ...cfg, shopName: `<script>alert(1)</script>`, website: { ...cfg.website, about: `"><img src=x onerror=alert(1)>`, links: { yelp: "javascript:alert(1)" } } }, jobs: {}, parts: {}, coupons, orders: {}, specs: {}, today: "2026-09-25" });
  const html = renderSite(p, { preview: true });
  assert.ok(!html.includes("<script>alert(1)"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes("javascript:alert"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes('"@type":"AutoRepair"'));
});

test("headline, web address and settings clean-up", () => {
  assert.equal(defaultTagline({ services: [{ name: "Oil change" }, { name: "Brakes" }, { name: "Tires" }], cityLine: "El Cajon, CA 92021" }), "Oil change, brakes & tires in El Cajon, done right.");
  assert.equal(slugify("Genie Auto Center"), "genie-auto-center");
  assert.equal(slugify("  A&B Lube!! "), "a-and-b-lube");
  const n = normalizeWebsite({ slug: "", highlights: ["  Fast ", ""], links: { yelp: "yelp.com/biz/x" } }, "Genie Auto Center");
  assert.equal(n.slug, "genie-auto-center");
  assert.deepEqual(n.highlights, ["Fast"]);
  assert.equal(n.links.yelp, "https://yelp.com/biz/x");
});

test("appointment request needs a name and a way to reach them", () => {
  assert.equal(validateRequest({ name: "", phone: "6195550100" }), "Please tell us your name.");
  assert.match(validateRequest({ name: "Al", phone: "555" }), /phone number or email/);
  assert.equal(validateRequest({ name: "Al", phone: "(619) 555-0100" }), "");
  assert.equal(validateRequest({ name: "Al", email: "al@example.com" }), "");
});

test("selling points come from what the shop can back up", () => {
  const cfg = { invoiceFooter: "We warrant parts and labor for 6 months or 6,000 miles. Our brake packages include a lifetime brake-pad replacement warranty." };
  const pkgs = [{ name: "Valvoline Full Synthetic Oil Change" }];
  const hl = autoHighlights({ cfg, week: parseHoursText("Mon-Sat 8-5"), stats: { services: 45000, plus: true, sinceYear: 2016 }, pkgs });
  assert.equal(hl.length, 4);
  assert.match(hl[0], /^Lifetime brake pads/);
  assert.match(hl[1], /^Genuine Valvoline oil/);
  assert.match(hl[3], /^Open Saturdays — 8am to 5pm/);
  /* nothing to back a claim up: honest generic ones, no lifetime pads, no brand */
  const bare = autoHighlights({ cfg: {}, week: parseHoursText("Mon-Fri 8-5"), stats: null, pkgs: [] });
  assert.equal(bare.length, 4);
  assert.ok(bare.every((h) => !/lifetime|valvoline|saturday/i.test(h)));
  assert.deepEqual(splitHighlight("Walk-ins welcome — no appointment needed"), { title: "Walk-ins welcome", sub: "No appointment needed" });
  assert.deepEqual(splitHighlight("Fast: in and out"), { title: "Fast", sub: "In and out" });
  assert.deepEqual(splitHighlight("Family owned"), { title: "Family owned", sub: "" });
});

test("every menu button finds its service page content", () => {
  const keys = ["Oil change", "Brakes", "Tires", "Air filters", "Cabin air filters", "Wipers", "Transmission", "Radiator", "Brake fluid", "Fuel system", "Power steering", "Differential fluid"].map((n) => serviceContent(n).key);
  assert.deepEqual(keys, ["oil", "brakes", "tires", "air", "cabin", "wipers", "trans", "coolant", "brakeFluid", "fuel", "steering", "diff"]);
  assert.equal(serviceContent("Engine diagnostics").key, "general");
});

test("service pages: one per menu button, linked from its card, how often from the shop", () => {
  const p = sitePayload({ cfg: { ...cfg, reminderMiles: 3000, reminderMonths: 3 }, jobs: {}, parts: {}, coupons, orders: {}, specs: {}, today: "2026-09-25" });
  assert.deepEqual(p.services.map((s) => s.slug), ["oil-change", "brakes"]);
  assert.equal(p.services[0].howOften, "Every 3,000 miles or 3 months, whichever comes first, unless your owner's manual says otherwise.");
  const html = renderSite(p, {});
  assert.ok(html.includes('href="#service-brakes"') && html.includes('id="service-brakes"'));
  assert.ok(html.includes("Signs your car needs it"));
  assert.ok(html.includes("images.unsplash.com/photo-"));
  assert.equal(intervalText({ basis: "inspect", miles: 15000 }), "We check it at every visit and replace it when it's worn, usually around every 15,000 miles.");
});
