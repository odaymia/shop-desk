/* How an email campaign went: the numbers the mail service reports
   (delivered, opened, clicked, bounced, marked as spam), which links got the
   clicks, and what only the shop's own records can say: who came in
   afterward and what they spent. Pure: no React, no storage.

   The raw facts are recorded per email by the "email" Edge Function from
   Resend's webhooks (supabase/email.sql: email_event). */
import { orderTotals } from "./invoice.js";

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const normEmail = (e) => String(e == null ? "" : e).trim().toLowerCase();
const DAY = 86400000;

/* "42%" or "—" when there's nothing to divide by. Under 1% shows one decimal. */
export function pct(n, of) {
  const d = num(of);
  if (d <= 0) return "—";
  const p = (num(n) / d) * 100;
  return p > 0 && p < 1 ? `${p.toFixed(1)}%` : `${Math.round(p)}%`;
}

/* One campaign's headline numbers from its row in the list
   ({ counts: { sent, … }, stats: { delivered, opened, clicked, bounced,
   complained } | null }). `tracked` is false until the mail service has
   reported anything for it, so the page can say "no data" instead of "0%".
   Rates are out of the emails delivered (or sent, before deliveries are in). */
export function campaignNumbers(m) {
  const c = (m && m.counts) || {};
  const s = (m && m.stats) || null;
  const sent = num(c.sent);
  const delivered = s ? num(s.delivered) : 0;
  const opened = s ? num(s.opened) : 0;
  const clicked = s ? num(s.clicked) : 0;
  const bounced = s ? num(s.bounced) : 0;
  const complained = s ? num(s.complained) : 0;
  const tracked = !!s && delivered + opened + clicked + bounced + complained > 0;
  const base = delivered || sent;
  return { sent, delivered, opened, clicked, bounced, complained, tracked, base, openRate: pct(opened, base), clickRate: pct(clicked, base), deliveredRate: pct(delivered, sent) };
}

/* A link as the owner would name it. */
export function linkLabel(url) {
  const u = String(url || "");
  if (/^tel:/i.test(u)) return `Call ${u.replace(/^tel:/i, "")}`;
  if (/^mailto:/i.test(u)) return `Email ${u.replace(/^mailto:/i, "")}`;
  if (/google\.[a-z.]+\/maps|maps\.app\.goo\.gl|maps\.apple\.com/i.test(u)) return "Directions";
  let x;
  try {
    x = new URL(u);
  } catch {
    return u.slice(0, 80);
  }
  const offer = x.searchParams.get("offer") || (x.hash.match(/^#offer-(.+)/) || [])[1];
  if (offer) return `Coupon ${offer.toUpperCase()}`;
  if (/\/portal\/?$/.test(x.pathname)) return "My Garage";
  const svc = (x.hash.match(/^#service-(.+)/) || [])[1];
  if (svc) return `Service page: ${svc.replace(/-/g, " ")}`;
  if (x.hash === "#book") return "Book an appointment";
  if (x.hash === "#tires") return "Shop for tires";
  const path = x.pathname.replace(/\/+$/, "");
  return `${x.hostname.replace(/^www\./, "")}${path}${x.hash && x.hash.length > 1 ? x.hash : ""}`.slice(0, 80) || u.slice(0, 80);
}

/* Which links got the clicks. `clicks` is one row per person per link
   ({ outbox_id, url, n }); the answer is one row per link, most people first. */
export function linkTable(clicks) {
  const by = new Map();
  for (const c of clicks || []) {
    if (!c || !c.url) continue;
    const r = by.get(c.url) || { url: c.url, label: linkLabel(c.url), people: 0, clicks: 0 };
    r.people += 1;
    r.clicks += Math.max(1, num(c.n));
    by.set(c.url, r);
  }
  return [...by.values()].sort((a, b) => b.people - a.people || b.clicks - a.clicks || a.label.localeCompare(b.label));
}

/* Who came in after the email, from the shop's own tickets.

   `rows` are the campaign's emails ({ email, status, sent_at, opened_at,
   clicked_at }). A customer counts when an invoice of theirs was posted
   within `windowDays` after their copy was sent. This says they came in
   after the email, not because of it; some would have come anyway.

   Returns { windowDays, open (the window hasn't closed for the newest
   send), people, tickets, sales, clickedPeople, clickedSales, visits: one
   row per customer who came in, biggest sale first }. */
export function campaignResults({ rows, customers, orders, cfg = {}, windowDays = 30, now = Date.now() }) {
  const sentAt = new Map(); // email -> { at, clicked, opened }
  let newest = 0;
  for (const r of rows || []) {
    if (!r || r.status !== "sent" || !r.sent_at) continue;
    const at = Date.parse(r.sent_at);
    if (!Number.isFinite(at)) continue;
    const e = normEmail(r.email);
    const have = sentAt.get(e);
    if (!have || at < have.at) sentAt.set(e, { at, clicked: !!r.clicked_at || !!(have && have.clicked), opened: !!r.opened_at || !!(have && have.opened) });
    if (at > newest) newest = at;
  }
  const byCustomer = new Map(); // customer id -> send info
  for (const c of Object.values(customers || {})) {
    if (!c || !c.id) continue;
    const hit = sentAt.get(normEmail(c.email));
    if (hit) byCustomer.set(c.id, hit);
  }
  const win = windowDays * DAY;
  const visits = new Map();
  let tickets = 0;
  for (const o of Object.values(orders || {})) {
    if (!o || o.status !== "invoiced" || !o.customerId) continue;
    const hit = byCustomer.get(o.customerId);
    const at = num(o.invoicedAt);
    if (!hit || !(at > hit.at && at <= hit.at + win)) continue;
    const c = customers[o.customerId];
    const total = num(orderTotals(o, cfg, c).total);
    const v = visits.get(o.customerId) || { customerId: o.customerId, name: [c.first, c.last].filter(Boolean).join(" ") || c.company || c.email || "", email: c.email || "", clicked: hit.clicked, opened: hit.opened, tickets: 0, sales: 0, first: at };
    v.tickets += 1;
    v.sales = Math.round((v.sales + total) * 100) / 100;
    if (at < v.first) v.first = at;
    visits.set(o.customerId, v);
    tickets += 1;
  }
  const list = [...visits.values()].sort((a, b) => b.sales - a.sales || a.first - b.first);
  const sum = (a) => Math.round(a.reduce((t, v) => t + v.sales, 0) * 100) / 100;
  const clicked = list.filter((v) => v.clicked);
  return {
    windowDays,
    open: newest > 0 && now < newest + win,
    emailed: sentAt.size,
    people: list.length,
    tickets,
    sales: sum(list),
    clickedPeople: clicked.length,
    clickedSales: sum(clicked),
    visits: list,
  };
}

/* The people behind one number, for a follow-up or a look: "clicked",
   "opened", "bounced", "complained", or "quiet" (delivered, never opened). */
export function recipientsWho(rows, what) {
  const pick = {
    clicked: (r) => !!r.clicked_at,
    opened: (r) => !!r.opened_at,
    bounced: (r) => !!r.bounced_at,
    complained: (r) => !!r.complained_at,
    quiet: (r) => r.status === "sent" && !r.opened_at && !r.bounced_at,
  }[what];
  if (!pick) return [];
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    if (!r || !pick(r)) continue;
    const e = normEmail(r.email);
    if (!e || seen.has(e)) continue;
    seen.add(e);
    out.push(r);
  }
  return out;
}
