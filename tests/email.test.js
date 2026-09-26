import { test } from "node:test";
import assert from "node:assert/strict";
import { renderEmail, fillPlaceholders } from "../src/lib/emailRender.js";
import { dueAutomations, automationsOf } from "../src/lib/emailAutomations.js";

const DAY = 86400000;
const now = Date.UTC(2026, 8, 25, 18);
const brand = { name: "Test Lube", logo: "https://x.example/logo.png", color: "#8e2f2f", address: "1 Main St, El Cajon, CA 92021", phone: "619-555-0100", website: "https://testlube.example/" };

test("the email: escaped, coupon and button, address and unsubscribe in the footer", () => {
  const { html, text } = renderEmail(brand, {
    subject: "Hi",
    preheader: "Save $20",
    headline: "Hi {first_name} <3",
    body: "Line one\n\nLine <b>two</b>",
    coupon: { off: "$20 off", line: "Any oil change", code: "WEB20", endsAt: "2026-10-31" },
    button: { label: "See specials", url: "https://testlube.example/#specials" },
  });
  assert.ok(html.includes("Hi {first_name} &lt;3"));
  assert.ok(html.includes("Line &lt;b&gt;two&lt;/b&gt;"));
  assert.ok(html.includes(">$20 OFF<") && html.includes("WEB20") && html.includes("Ends 2026-10-31"));
  assert.ok(html.includes('href="https://testlube.example/#specials"'));
  assert.ok(html.includes("1 Main St, El Cajon, CA 92021") && html.includes('href="{unsubscribe_url}"'));
  assert.ok(!/<script|data:image/i.test(html));
  assert.ok(text.includes("Code: WEB20") && text.includes("Unsubscribe: {unsubscribe_url}"));
  /* javascript: links never make it in */
  assert.ok(!renderEmail(brand, { body: "x", button: { label: "Go", url: "javascript:alert(1)" } }).html.includes("javascript:"));
});

test("placeholders: per-person values, escaped, 'there' when no name", () => {
  assert.equal(fillPlaceholders("Hi {first_name}", {}), "Hi there");
  assert.equal(fillPlaceholders("Hi {first_name}", { first_name: "<Ana>" }), "Hi &lt;Ana&gt;");
  assert.equal(fillPlaceholders("Hi {first_name}", { first_name: "<Ana>" }, { html: false }), "Hi <Ana>");
  assert.equal(fillPlaceholders("{vehicle} due {due_date}", { vehicle: "2018 Civic", due_date: "Oct 3" }), "2018 Civic due Oct 3");
});

const on = (k, extra = {}) => ({ email: { automations: { [k]: { on: true, ...extra } } }, reminderMonths: 3, oilPackages: [{ name: "Valvoline Conventional Oil Change" }] });
const customers = {
  a: { id: "a", first: "Ana", email: "ana@example.com" },
  b: { id: "b", first: "Bo", email: "bo@example.com", emailOptOut: true },
  c: { id: "c", first: "Cy", email: "cy@example.com" },
  d: { id: "d", first: "Di", email: "" },
};
const vehicles = { va: { id: "va", customerId: "a", year: 2018, make: "Honda", model: "Civic" }, vb: { id: "vb", customerId: "b" }, vc: { id: "vc", customerId: "c", year: 2015, make: "Ford", model: "F-150" } };
const inv = (id, cust, veh, daysAgo, job = "Brake pads") => ({ id, customerId: cust, vehicleId: veh, status: "invoiced", invoicedAt: now - daysAgo * DAY, lines: [{ kind: "labor", job, description: job }] });

test("thank you: the day after a visit, not for opted-out or no-email customers", () => {
  const orders = { 1: inv("1", "a", "va", 1.2), 2: inv("2", "b", "vb", 1.2), 3: inv("3", "c", "vc", 5), 4: inv("4", "d", null, 1.2) };
  const due = dueAutomations({ cfg: on("thanks"), customers, vehicles, orders, signups: [], now });
  assert.deepEqual(due.map((d) => [d.kind, d.dedupe, d.email]), [["thanks", "thanks:1", "ana@example.com"]]);
  /* nothing when it's off */
  assert.equal(dueAutomations({ cfg: {}, customers, vehicles, orders, signups: [], now }).length, 0);
});

test("oil reminder: around the sticker date only, with the car and the date", () => {
  const oilDaysAgo = (now - new Date(new Date(now).setMonth(new Date(now).getMonth() - 3))) / DAY - 2; // due 2 days from now
  const orders = {
    1: inv("1", "a", "va", oilDaysAgo, "Valvoline Conventional Oil Change"),
    2: inv("2", "c", "vc", 400, "Valvoline Conventional Oil Change"), // due a year ago: not suddenly emailed
    3: inv("3", "a", "va", 30, "Brake pads"), // a later non-oil visit doesn't reset the oil clock
  };
  const due = dueAutomations({ cfg: on("oil"), customers, vehicles, orders, signups: [], now });
  assert.equal(due.length, 1);
  assert.equal(due[0].dedupe, "oil:va:1");
  assert.equal(due[0].vars.vehicle, "2018 Honda Civic");
  assert.match(due[0].vars.due_date, /^September 27$/);
});

test("win-back: only people who just crossed the line, never the whole back catalog", () => {
  const orders = { 1: inv("1", "a", "va", 6 * 30.4 + 3), 2: inv("2", "c", "vc", 900) };
  const due = dueAutomations({ cfg: on("winback", { months: 6 }), customers, vehicles, orders, signups: [], now });
  assert.deepEqual(due.map((d) => d.email), ["ana@example.com"]);
});

test("welcome: fresh website signups, not imported lists or the unsubscribed", () => {
  const iso = (d) => new Date(now - d * DAY).toISOString();
  const signups = [
    { email: "new@example.com", name: "Nia Lopez", source: "", created_at: iso(0.1) },
    { email: "old@example.com", name: "Old", source: "", created_at: iso(20) },
    { email: "shop@example.com", name: "S", source: "SHOPIFY", created_at: iso(0.1) },
    { email: "gone@example.com", name: "G", source: "", created_at: iso(0.1), unsubscribed_at: iso(0) },
    { email: "blocked@example.com", name: "B", source: "", created_at: iso(0.1) },
  ];
  const due = dueAutomations({ cfg: on("welcome"), customers: {}, vehicles: {}, orders: {}, signups, suppressed: new Set(["blocked@example.com"]), now });
  assert.deepEqual(due.map((d) => [d.email, d.vars.first_name, d.dedupe]), [["new@example.com", "Nia", "welcome:new@example.com"]]);
});

test("saved settings merge over the defaults", () => {
  const a = automationsOf({ email: { automations: { oil: { on: true, leadDays: 7 } } } });
  assert.equal(a.oil.on, true);
  assert.equal(a.oil.leadDays, 7);
  assert.match(a.oil.subject, /oil change/);
  assert.equal(a.thanks.on, false);
});

test("compose: brand from settings, coupon with its landing page, review button", async () => {
  const { composeEmail, siteHome } = await import("../src/lib/emailCompose.js");
  const cfg = { shopName: "Test Lube", shopAddress: "1 Main St", shopPhone: "619-555-0100", logo: "data:image/png;base64,xx", website: { slug: "test-lube", domain: "www.testlube.example", cityLine: "El Cajon, CA 92021", offers: { c1: {} }, links: { google: "https://g.page/r/abc/review" } } };
  assert.equal(siteHome(cfg, "https://app.example/"), "https://www.testlube.example/");
  assert.equal(siteHome({ website: { slug: "x" } }, "https://app.example/"), "https://app.example/site/?s=x");
  const coupons = { c1: { id: "c1", code: "WEB20", name: "$20 OFF ANY OIL CHANGE", kind: "amount", value: 20, endsAt: "2026-10-31" } };
  const m = composeEmail(cfg, coupons, { subject: "Deal", headline: "Hi", body: "x", couponId: "c1", button: "site" }, { logoUrl: "https://app.example/logo.png" });
  assert.ok(m.html.includes("https://www.testlube.example/?offer=web20"));
  assert.ok(m.html.includes("ANY OIL CHANGE") && m.html.includes("WEB20"));
  assert.ok(m.html.includes("https://app.example/logo.png") && !m.html.includes("data:image"));
  assert.ok(m.html.includes("1 Main St, El Cajon, CA 92021"));
  const r = composeEmail(cfg, coupons, { subject: "Thanks", body: "x", button: "review" });
  assert.ok(r.html.includes("https://g.page/r/abc/review") && r.html.includes("Leave us a review"));
});
