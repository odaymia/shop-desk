import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as nodeModule from "node:module";
import { pct, campaignNumbers, linkLabel, linkTable, campaignResults, recipientsWho } from "../src/lib/emailStats.js";

test("pct: rounds, shows small rates, and never divides by nothing", () => {
  assert.equal(pct(42, 100), "42%");
  assert.equal(pct(1, 3), "33%");
  assert.equal(pct(1, 400), "0.3%");
  assert.equal(pct(0, 50), "0%");
  assert.equal(pct(5, 0), "—");
});

test("campaignNumbers: rates are out of delivered, and no data is not 0%", () => {
  const n = campaignNumbers({ counts: { sent: 200, failed: 3 }, stats: { delivered: 190, opened: 95, clicked: 19, bounced: 10, complained: 1 } });
  assert.equal(n.tracked, true);
  assert.equal(n.openRate, "50%"); // 95 of 190 delivered
  assert.equal(n.clickRate, "10%");
  assert.equal(n.deliveredRate, "95%");
  // sent before tracking was set up: the mail service never reported anything
  const old = campaignNumbers({ counts: { sent: 200 }, stats: { delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0 } });
  assert.equal(old.tracked, false);
  // the stats query isn't installed yet
  assert.equal(campaignNumbers({ counts: { sent: 5 }, stats: null }).tracked, false);
  // deliveries not in yet, but an open is: rate falls back to sent
  assert.equal(campaignNumbers({ counts: { sent: 10 }, stats: { delivered: 0, opened: 2, clicked: 0, bounced: 0, complained: 0 } }).openRate, "20%");
});

test("linkLabel names links the way the owner thinks of them", () => {
  assert.equal(linkLabel("tel:+16193122480"), "Call +16193122480");
  assert.equal(linkLabel("https://www.google.com/maps/dir/?api=1&destination=Genie"), "Directions");
  assert.equal(linkLabel("https://genieautocenter.com/?offer=fall10"), "Coupon FALL10");
  assert.equal(linkLabel("https://genieautocenter.com/#offer-fall10"), "Coupon FALL10");
  assert.equal(linkLabel("https://genieautocenter.com/portal/"), "My Garage");
  assert.equal(linkLabel("https://genieautocenter.com/#service-brake-service"), "Service page: brake service");
  assert.equal(linkLabel("https://genieautocenter.com/#book"), "Book an appointment");
  assert.equal(linkLabel("https://www.genieautocenter.com/"), "genieautocenter.com");
  assert.equal(linkLabel("not a url"), "not a url");
});

test("linkTable: one row per link, people before raw clicks", () => {
  const t = linkTable([
    { outbox_id: 1, url: "https://x.example/#book", n: 1 },
    { outbox_id: 2, url: "https://x.example/#book", n: 4 },
    { outbox_id: 3, url: "tel:+15550100", n: 9 },
    { outbox_id: 1, url: "tel:+15550100", n: 1 },
    { outbox_id: 4, url: "https://x.example/#book", n: 1 },
  ]);
  assert.deepEqual(t.map((r) => [r.label, r.people, r.clicks]), [["Book an appointment", 3, 6], ["Call +15550100", 2, 10]]);
  assert.deepEqual(linkTable(null), []);
});

const day = 86400000;
const t0 = Date.UTC(2026, 9, 1, 17);
const iso = (ms) => new Date(ms).toISOString();
const customers = {
  a: { id: "a", first: "Ana", last: "Lopez", email: "Ana@Example.com" },
  b: { id: "b", first: "Ben", last: "Ito", email: "ben@example.com" },
  c: { id: "c", first: "Cy", last: "Vo", email: "cy@example.com" },
  d: { id: "d", first: "Dee", last: "Roe", email: "dee@example.com" }, // not emailed
};
const ticket = (id, customerId, at, rate, status = "invoiced") => ({ id, customerId, status, invoicedAt: at, lines: [{ id: id + "l", kind: "labor", description: "Oil change", hours: 1, rate }], payments: [] });
const cfg = { taxRate: 0, laborTaxable: false, suppliesPct: 0 };

test("campaignResults: who came in within the window after their email, and what they spent", () => {
  const rows = [
    { email: "ana@example.com", status: "sent", sent_at: iso(t0), opened_at: iso(t0 + 3600e3), clicked_at: iso(t0 + 3700e3) },
    { email: "ben@example.com", status: "sent", sent_at: iso(t0), opened_at: iso(t0 + day) },
    { email: "cy@example.com", status: "sent", sent_at: iso(t0 + 2 * day) }, // went out two days later (daily limit)
    { email: "eve@example.com", status: "skipped" }, // never sent
  ];
  const orders = {
    o1: ticket("o1", "a", t0 + 5 * day, 100), // Ana, clicked, came in
    o2: ticket("o2", "a", t0 + 20 * day, 60), // and again
    o3: ticket("o3", "b", t0 + 31 * day, 80), // Ben: a day too late
    o4: ticket("o4", "b", t0 - day, 80), // Ben: before the email
    o5: ticket("o5", "c", t0 + 31 * day, 50), // Cy: his clock started two days later, so this counts
    o6: ticket("o6", "d", t0 + 5 * day, 500), // Dee was never emailed
    o7: ticket("o7", "a", t0 + 6 * day, 999, "estimate"), // not an invoice
  };
  const r = campaignResults({ rows, customers, orders, cfg, windowDays: 30, now: t0 + 90 * day });
  assert.equal(r.emailed, 3);
  assert.equal(r.people, 2);
  assert.equal(r.tickets, 3);
  assert.equal(r.sales, 210);
  assert.equal(r.clickedPeople, 1);
  assert.equal(r.clickedSales, 160);
  assert.equal(r.open, false);
  assert.deepEqual(r.visits.map((v) => [v.name, v.tickets, v.sales, v.clicked]), [["Ana Lopez", 2, 160, true], ["Cy Vo", 1, 50, false]]);
  // looked at a week in: the window is still open, so the number can grow
  assert.equal(campaignResults({ rows, customers, orders, cfg, now: t0 + 7 * day }).open, true);
  // nothing sent: nothing to report
  assert.equal(campaignResults({ rows: [], customers, orders, cfg }).people, 0);
});

test("recipientsWho: the people behind each number, once each", () => {
  const rows = [
    { email: "a@x.com", status: "sent", opened_at: "t", clicked_at: "t" },
    { email: "A@x.com", status: "sent", opened_at: "t", clicked_at: "t" },
    { email: "b@x.com", status: "sent", opened_at: "t" },
    { email: "c@x.com", status: "sent" },
    { email: "d@x.com", status: "sent", bounced_at: "t" },
    { email: "e@x.com", status: "sent", complained_at: "t", opened_at: "t" },
  ];
  assert.deepEqual(recipientsWho(rows, "clicked").map((r) => r.email), ["a@x.com"]);
  assert.equal(recipientsWho(rows, "opened").length, 3);
  assert.deepEqual(recipientsWho(rows, "quiet").map((r) => r.email), ["c@x.com"]);
  assert.deepEqual(recipientsWho(rows, "bounced").map((r) => r.email), ["d@x.com"]);
  assert.deepEqual(recipientsWho(rows, "complained").map((r) => r.email), ["e@x.com"]);
  assert.deepEqual(recipientsWho(rows, "nonsense"), []);
});

/* ---- the webhook code that runs in the email Edge Function ----
   The function is TypeScript for Deno and can't be imported here, so the two
   functions that decide what a notice is and whether it's genuine are lifted
   out of the file between their markers and run as they are. */
const strip = nodeModule.stripTypeScriptTypes;
test("email webhook: genuine notices are accepted, forged or stale ones are not", { skip: !strip && "this Node can't strip TypeScript types" }, async () => {
  const src = fs.readFileSync(new URL("../supabase/functions/email/index.ts", import.meta.url), "utf8");
  const a = src.indexOf("/* <webhook-core> */");
  const b = src.indexOf("/* </webhook-core> */");
  assert.ok(a > 0 && b > a, "webhook-core markers are in the function");
  const js = strip(src.slice(a, b));
  const { validWebhook, readEvent } = new Function("str", `${js}; return { validWebhook, readEvent };`)((s) => String(s ?? "").trim());

  // the example Svix publishes for checking an implementation by hand
  const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
  const id = "msg_p5jXN8AQM9LWM0D4loKWxJek";
  const ts = "1614265330";
  const body = '{"test": 2432232314}';
  const sig = "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=";
  const at = Number(ts) * 1000;
  assert.equal(await validWebhook(secret, id, ts, sig, body, at), true);
  assert.equal(await validWebhook(secret, id, ts, `v1,AAAA ${sig}`, body, at), true); // several signatures: any one may match
  assert.equal(await validWebhook(secret, id, ts, sig, body + " ", at), false); // body changed
  assert.equal(await validWebhook(secret, "msg_other", ts, sig, body, at), false);
  assert.equal(await validWebhook("whsec_" + Buffer.from("wrong key").toString("base64"), id, ts, sig, body, at), false);
  assert.equal(await validWebhook(secret, id, ts, sig, body, at + 6 * 60 * 1000), false); // older than five minutes: a replay
  assert.equal(await validWebhook("", id, ts, sig, body, at), false); // secret not set: nothing gets in
  assert.equal(await validWebhook(secret, id, ts, "", body, at), false);

  // what each kind of notice turns into
  const unsub = ["https://shop.example/unsubscribe/", "https://proj.supabase.co/functions/v1/email"];
  const ev = (type, data) => ({ type, created_at: "2026-11-21T18:00:00.000Z", data: { email_id: "re_1", ...data } });
  assert.deepEqual(readEvent(ev("email.delivered", {}), unsub), { kind: "delivered", providerId: "re_1", url: "", at: "2026-11-21T18:00:00.000Z", detail: "" });
  assert.equal(readEvent(ev("email.opened", {}), unsub).kind, "opened");
  const click = readEvent(ev("email.clicked", { click: { link: "https://shop.example/#book", timestamp: "2026-11-21T18:05:00.000Z" } }), unsub);
  assert.deepEqual([click.kind, click.url, click.at], ["clicked", "https://shop.example/#book", "2026-11-21T18:05:00.000Z"]);
  // tapping unsubscribe is not interest in the offer
  assert.equal(readEvent(ev("email.clicked", { click: { link: "https://shop.example/unsubscribe/?u=abc" } }), unsub), null);
  assert.equal(readEvent(ev("email.clicked", { click: { link: "https://proj.supabase.co/functions/v1/email?u=abc" } }), unsub), null);
  assert.equal(readEvent(ev("email.bounced", { bounce: { type: "Transient" } }), unsub).detail, "Transient");
  assert.equal(readEvent(ev("email.bounced", {}), unsub).detail, "Permanent"); // unlabelled bounces are treated as hard
  assert.equal(readEvent(ev("email.complained", {}), unsub).kind, "complained");
  // kinds we don't record, and notices with no email id
  assert.equal(readEvent(ev("email.sent", {}), unsub), null);
  assert.equal(readEvent({ type: "email.opened", data: {} }, unsub), null);
});
