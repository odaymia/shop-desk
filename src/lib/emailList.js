/* The shop's email list: every customer with an email on file, plus everyone
   who signed up on the website, merged by address. Pure — no React, no
   storage. The Email list page shows it; the CSV goes to whatever the shop
   sends mail with (Mailchimp, Constant Contact, …), which handles the
   unsubscribe link every marketing email must carry.

   Someone who unsubscribes stays on the list, marked, so they're never
   exported or copied again — deleting them would let the next import or
   signup quietly put them back. */

const str = (s) => String(s == null ? "" : s).trim();
export const normEmail = (e) => str(e).toLowerCase();
export const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(str(e));

/* One row per address.
   customers: { id: customer }   signups: [{ id, email, name, source, created_at, unsubscribed_at }] */
export function buildEmailList({ customers, orders, signups }) {
  /* last visit and visit count per customer, in one pass over the orders */
  const visits = {};
  for (const o of Object.values(orders || {})) {
    if (!o || o.status !== "invoiced" || !o.customerId) continue;
    const v = (visits[o.customerId] = visits[o.customerId] || { n: 0, last: 0 });
    v.n++;
    if ((o.invoicedAt || 0) > v.last) v.last = o.invoicedAt || 0;
  }

  const by = new Map();
  let invalid = 0;
  const row = (email) => {
    const k = normEmail(email);
    if (!by.has(k)) by.set(k, { email: str(email), first: "", last: "", phone: "", customer: false, website: false, customerIds: [], signupIds: [], lastVisit: 0, visits: 0, signedUpAt: 0, source: "", unsubscribed: false });
    return by.get(k);
  };

  for (const c of Object.values(customers || {})) {
    if (!c || c.active === false || !str(c.email)) continue;
    if (!validEmail(c.email)) {
      invalid++;
      continue;
    }
    const r = row(c.email);
    r.customer = true;
    r.customerIds.push(c.id);
    const v = visits[c.id];
    if (v) {
      r.visits += v.n;
      if (v.last > r.lastVisit) r.lastVisit = v.last;
    }
    if (!r.first) r.first = str(c.first);
    if (!r.last) r.last = str(c.last);
    if (!r.phone) r.phone = str(c.phone);
    if (c.emailOptOut) r.unsubscribed = true;
  }

  for (const s of signups || []) {
    if (!s || !validEmail(s.email)) continue;
    const r = row(s.email);
    r.website = true;
    r.signupIds.push(s.id);
    const at = s.created_at ? Date.parse(s.created_at) : 0;
    if (at && (!r.signedUpAt || at < r.signedUpAt)) {
      r.signedUpAt = at;
      r.source = str(s.source);
    }
    if (!r.first && str(s.name)) {
      const [f, ...l] = str(s.name).split(/\s+/);
      r.first = f;
      r.last = l.join(" ");
    }
    if (s.unsubscribed_at) r.unsubscribed = true;
  }

  const rows = [...by.values()].sort((a, b) => Math.max(b.lastVisit, b.signedUpAt) - Math.max(a.lastVisit, a.signedUpAt) || a.email.localeCompare(b.email));
  return { rows, invalid };
}

const DAY = 86400000;
/* Filters on the page: who, and how long since their last visit. */
export function filterEmailList(rows, { who = "all", since = "any", q = "" } = {}, now = Date.now()) {
  const needle = str(q).toLowerCase();
  return rows.filter((r) => {
    if (who === "customers" && !r.customer) return false;
    if (who === "website" && !r.website) return false;
    if (who === "unsubscribed" ? !r.unsubscribed : r.unsubscribed) return false; // unsubscribed people only show under their own filter
    if (since !== "any") {
      const age = r.lastVisit ? (now - r.lastVisit) / DAY : Infinity;
      if (since === "6mo" && !(age <= 183)) return false;
      if (since === "6to12" && !(age > 183 && age <= 365)) return false;
      if (since === "12plus" && !(age > 365 && r.lastVisit)) return false;
      if (since === "never" && r.lastVisit) return false;
    }
    if (needle && !`${r.email} ${r.first} ${r.last} ${r.phone}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}

const csvCell = (v) => {
  /* names come from a public form: never let a cell start a spreadsheet formula */
  const s = String(v == null ? "" : v).replace(/^[=+\-@\t\r]/, "'$&");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const ymd = (t) => (t ? new Date(t).toISOString().slice(0, 10) : "");

/* A CSV any email service imports. Unsubscribed people are never in it. */
export function emailListCsv(rows) {
  const head = ["Email Address", "First Name", "Last Name", "Phone Number", "Tags", "Last Visit", "Visits", "Signed Up"];
  const lines = rows
    .filter((r) => !r.unsubscribed)
    .map((r) =>
      [r.email, r.first, r.last, r.phone, [r.customer && "customer", r.website && "website signup", r.source && `offer ${r.source}`].filter(Boolean).join(", "), ymd(r.lastVisit), r.visits || "", ymd(r.signedUpAt)]
        .map(csvCell)
        .join(",")
    );
  return [head.join(","), ...lines].join("\r\n") + "\r\n";
}
