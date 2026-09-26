/* The CRM's automatic emails: who is due for which one today. Pure — no
   React, no storage, no sending. The desk runs this once a day, queues what
   it finds, and the server sends it.

   Every email carries a `dedupe` key, and the server refuses a key it has
   seen before, so running this twice (or on two computers) never sends
   anyone the same email twice.

   Each rule only looks at a short, recent window (a visit that happened a
   day ago, a reminder that came due this week, a customer who crossed six
   months away this month). Turning an automation on therefore never blasts
   years of old customers at once; it starts with the people crossing the
   line from today on. */
import { validEmail, normEmail } from "./emailList.js";

const DAY = 86400000;
const MONTH = 30.4 * DAY;
const str = (s) => String(s == null ? "" : s).trim();

/* Each automatic email is a subject plus blocks (see emailBlocks.js),
   laid out to look like a modern marketing email out of the box. */
const OIL_PHOTO = "1784619588643-d5a7bfda632b";
const SHOP_PHOTO = "1625047509248-ec889cbff17f";
const HOOD_PHOTO = "1713757553447-f8f092417cf9";
export const DEFAULT_AUTOMATIONS = {
  thanks: {
    on: false,
    delayDays: 1,
    subject: "Thanks for coming in, {first_name}!",
    preheader: "It means a lot to a local shop.",
    theme: { header: "dark", corners: "rounded" },
    blocks: [
      { id: "t1", type: "text", title: "Thanks for choosing us", text: "Hi {first_name},\n\nThanks for trusting us with your car. If anything doesn't seem right, call us and we'll make it right." },
      { id: "t2", type: "text", title: "", text: "Got a minute? A quick review helps other drivers find an honest shop." },
      { id: "t3", type: "button", label: "Leave us a review", link: "review", url: "" },
    ],
  },
  oil: {
    on: false,
    leadDays: 3, // send this many days before the date on the window sticker
    subject: "{first_name}, your {vehicle} is due for an oil change",
    preheader: "No appointment needed. Just pull in.",
    theme: { header: "dark", corners: "rounded" },
    blocks: [
      { id: "o1", type: "hero", photo: OIL_PHOTO, headline: "Time for an oil change", text: "Hi {first_name}, your {vehicle} is due for its next oil change around {due_date}. Staying on schedule is the cheapest way to keep an engine healthy.", buttonLabel: "See our oil change prices", link: "site", url: "" },
      { id: "o2", type: "coupon", couponId: "", note: "Show this email at the counter." },
      { id: "o3", type: "visit", title: "No appointment needed" },
    ],
  },
  winback: {
    on: false,
    months: 6, // no visit in this many months
    subject: "We miss you, {first_name}",
    preheader: "Here's a little something to bring you back.",
    theme: { header: "dark", corners: "rounded" },
    blocks: [
      { id: "w1", type: "hero", photo: SHOP_PHOTO, headline: "It's been a while", text: "Hi {first_name}, we haven't seen you in a while, and your car is probably due for some attention. Here's a little something to bring you back.", buttonLabel: "See what's due", link: "offer", url: "" },
      { id: "w2", type: "coupon", couponId: "", note: "Show this email at the counter." },
      { id: "w3", type: "services", title: "Worth a look", ids: [] },
      { id: "w4", type: "visit", title: "Come see us" },
    ],
  },
  welcome: {
    on: false,
    subject: "Welcome to the list, {first_name}!",
    preheader: "Here's a thank-you for your first visit.",
    theme: { header: "dark", corners: "rounded" },
    blocks: [
      { id: "n1", type: "hero", photo: HOOD_PHOTO, headline: "Thanks for signing up", text: "Hi {first_name}, you're on the list. We'll send specials and a heads-up when your car is due, a few emails a month at most.", buttonLabel: "", link: "site", url: "" },
      { id: "n2", type: "coupon", couponId: "", note: "A thank-you for your first visit." },
      { id: "n3", type: "services", title: "What we do", ids: [] },
      { id: "n4", type: "visit", title: "Come see us" },
    ],
  },
};

export const AUTOMATION_INFO = {
  thanks: { title: "Thank you + review", when: "The day after a visit" },
  oil: { title: "Oil change reminder", when: "When the date on their window sticker comes up" },
  winback: { title: "We miss you", when: "When a customer hasn't been in for a while" },
  welcome: { title: "Welcome", when: "Right after someone signs up on the website" },
};

export const automationsOf = (cfg) => {
  const saved = (cfg && cfg.email && cfg.email.automations) || {};
  return Object.fromEntries(
    Object.entries(DEFAULT_AUTOMATIONS).map(([k, d]) => {
      const mine = saved[k] || {};
      /* wording saved before blocks existed (headline, body, coupon, button)
         is the owner's: keep it rather than the new default layout */
      const legacy = !mine.blocks && (mine.headline || mine.body || mine.couponId);
      const merged = { ...d, ...mine };
      if (legacy) delete merged.blocks;
      return [k, merged];
    })
  );
};

/* "oil change" lines, the same test the customer portal's reminders use */
const OIL = /\boil\b(?!.*(?:cooler|pan|pressure|leak))/i;
export const isOilOrder = (o, pkgNames) => (o.lines || []).some((l) => l.kind !== "note" && (OIL.test(`${l.job || ""}: ${l.description || ""}`) || pkgNames.has(str(l.job).toLowerCase())));
export const fmtDay = (t) => new Date(t).toLocaleDateString("en-US", { month: "long", day: "numeric" });
export const vehicleName = (v) => (v ? [v.year, v.make, v.model].filter(Boolean).join(" ") : "") || "car";
export const addMonths = (t, m) => {
  const d = new Date(t);
  d.setMonth(d.getMonth() + Number(m || 0));
  return d.getTime();
};

/* → [{ kind, dedupe, email, vars: { first_name, vehicle, due_date } }]
   suppressed: Set of lowercased emails that must never get marketing mail */
export function dueAutomations({ cfg, customers, vehicles, orders, signups, suppressed, now = Date.now() }) {
  const auto = automationsOf(cfg);
  const blocked = suppressed || new Set();
  const out = [];
  const reachable = (c) => c && c.active !== false && !c.emailOptOut && validEmail(c.email) && !blocked.has(normEmail(c.email));
  const push = (kind, dedupe, email, vars) => out.push({ kind, dedupe, email: str(email), vars });

  /* invoices by customer and by vehicle, newest first, in one pass */
  const byCustomer = {};
  const byVehicle = {};
  for (const o of Object.values(orders || {})) {
    if (!o || o.status !== "invoiced" || !o.invoicedAt) continue;
    if (o.customerId) (byCustomer[o.customerId] = byCustomer[o.customerId] || []).push(o);
    if (o.vehicleId) (byVehicle[o.vehicleId] = byVehicle[o.vehicleId] || []).push(o);
  }
  for (const l of Object.values(byCustomer)) l.sort((a, b) => b.invoicedAt - a.invoicedAt);
  for (const l of Object.values(byVehicle)) l.sort((a, b) => b.invoicedAt - a.invoicedAt);

  /* thank you: the day after a visit (a two-day window in case the desk wasn't open) */
  if (auto.thanks.on) {
    const d = Math.max(0, Number(auto.thanks.delayDays) || 0);
    for (const [cid, list] of Object.entries(byCustomer)) {
      const c = customers[cid];
      const last = list[0];
      const age = now - last.invoicedAt;
      if (!reachable(c) || age < d * DAY || age > (d + 2) * DAY) continue;
      push("thanks", `thanks:${last.id}`, c.email, { first_name: str(c.first) });
    }
  }

  /* oil change reminder: the sticker date (last oil change + the shop's
     reminder months), from a few days before it until two weeks after */
  if (auto.oil.on) {
    const months = Number(cfg.reminderMonths) || 3;
    const lead = Math.max(0, Number(auto.oil.leadDays) || 0);
    const pkgNames = new Set((cfg.oilPackages || []).map((p) => str(p.name).toLowerCase()).filter(Boolean));
    for (const [vid, list] of Object.entries(byVehicle)) {
      const v = vehicles[vid];
      if (!v || v.active === false) continue;
      const last = list.find((o) => isOilOrder(o, pkgNames));
      if (!last) continue;
      const due = addMonths(last.invoicedAt, months);
      if (now < due - lead * DAY || now > due + 14 * DAY) continue;
      const c = customers[v.customerId || last.customerId];
      if (!reachable(c)) continue;
      push("oil", `oil:${vid}:${last.id}`, c.email, { first_name: str(c.first), vehicle: vehicleName(v), due_date: fmtDay(due) });
    }
  }

  /* we miss you: the last visit crossed N months ago within the last 30 days */
  if (auto.winback.on) {
    const m = Math.max(1, Number(auto.winback.months) || 6);
    for (const [cid, list] of Object.entries(byCustomer)) {
      const c = customers[cid];
      const age = now - list[0].invoicedAt;
      if (!reachable(c) || age < m * MONTH || age > m * MONTH + 30 * DAY) continue;
      push("winback", `winback:${m}:${cid}:${list[0].id}`, c.email, { first_name: str(c.first) });
    }
  }

  /* welcome: people who signed up on the website this past week (not lists
     brought in from elsewhere; they didn't just sign up) */
  if (auto.welcome.on) {
    for (const s of signups || []) {
      if (!s || s.unsubscribed_at || !validEmail(s.email) || blocked.has(normEmail(s.email))) continue;
      if (s.source === "SHOPIFY" || s.source === "IMPORT") continue;
      const at = Date.parse(s.created_at || "");
      if (!at || now - at > 7 * DAY) continue;
      push("welcome", `welcome:${normEmail(s.email)}`, s.email, { first_name: str(s.name).split(/\s+/)[0] || "" });
    }
  }

  /* one email per person per kind per day: two cars due the same week get one reminder each, but not two thank-yous */
  const seen = new Set();
  return out.filter((e) => {
    if (e.kind === "oil") return true;
    const k = `${e.kind}|${normEmail(e.email)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
