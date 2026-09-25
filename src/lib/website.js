/* The shop's public website, built from the desk's own records: name,
   address, hours, the service menu, oil change packages, published prices,
   the coupons the owner chose to advertise, and the shop's own oil specs
   for an instant "what does my car cost" quote. Pure — no React, DOM, or
   storage. src/lib/siteRender.js turns the payload into the page.

   Nothing internal reaches the payload: no customers, no costs, no labor
   rate, no coupon the owner didn't tick. */
import { jobLines, orderTotals } from "./invoice.js";
import { serviceContent } from "./serviceContent.js";
import { DEFAULT_SERVICE_INTERVALS } from "./serviceReview.js";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const str = (s) => String(s == null ? "" : s).trim();
const uidOf = () => "w" + Math.random().toString(36).slice(2, 8);

export const DEFAULT_WEBSITE = {
  enabled: false, // published at /site/?s=<slug> once turned on
  slug: "", // the web address: letters, numbers, dashes
  tagline: "", // big line at the top; blank builds one from the shop's services
  about: "", // a paragraph about the shop; blank uses a sensible default
  cityLine: "", // "El Cajon, CA 92021" — completes the street address for maps and Google
  timeZone: "America/Los_Angeles", // the shop's clock, for "Open now"
  brandColor: "#8e2f2f",
  accentColor: "#1e8fd0",
  heroPhoto: "", // data URL, shrunk on upload
  highlights: [], // "Headline — supporting line", one per line; blank draws them from the shop's records
  hoursWeek: null, // [{ closed, open: "08:00", close: "18:00" }] × 7, Sunday first; null = parse cfg.hours
  showPrices: true, // oil change packages and published canned-job prices
  showStats: true, // "since 2016 · 45,000+ services" from the invoice history
  quoteTool: true, // the pick-your-car oil change quote, from the shop's own specs
  booking: true, // appointment request form
  walkIn: [], // service-menu ids that are first come, first served (no appointments), e.g. ["oil"]
  hiddenPackages: [], // oil package ids left off the site (e.g. customer-supplied oil)
  couponIds: [], // coupons the owner chose to advertise; none by default
  couponCodes: true, // print the code on the advertised coupon
  offers: {}, // { couponId: { headline, blurb } } — coupons with their own ad landing page (#offer-<code>)
  serviceBlurbs: {}, // { "Brakes": "custom text" } overrides
  faq: [], // [{ q, a }]; blank uses defaults
  links: { google: "", yelp: "", facebook: "", instagram: "" },
};

/* Selling points under the headline. Written as "Headline — supporting
   line". When the owner hasn't written their own, they're drawn from what
   the shop can actually back up: its warranty text, the oil it pours, its
   hours, its history. Nothing is claimed that the records don't show. */
export const FALLBACK_HIGHLIGHTS = [
  "No surprises — prices posted up front and a written estimate before any work starts",
  "Walk-ins welcome — no appointment needed for most services",
  "Done right the first time — every repair is backed by our warranty",
  "Real people, straight answers — we tell you what needs fixing now and what can wait",
];

/* "Headline — supporting line" → { title, sub } */
export function splitHighlight(h) {
  const t = str(h);
  const m = t.match(/^(.{2,60}?)\s+[—–-]\s+(.+)$/) || t.match(/^([^:]{2,60}):\s+(.+)$/);
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  return m ? { title: m[1].trim(), sub: cap(m[2].trim()) } : { title: t, sub: "" };
}

export function autoHighlights({ cfg, week, stats, pkgs }) {
  const out = [];
  const footer = str(cfg.invoiceFooter);
  if (/lifetime brake[- ]?pad/i.test(footer)) out.push("Lifetime brake pads — buy a brake package once and we replace the pads free for as long as you own the car");
  const brand = (pkgs || []).map((p) => (str(p.name).match(/\b(Valvoline|Mobil ?1|Castrol|Pennzoil|Quaker State)\b/i) || [])[1]).find(Boolean);
  if (brand) out.push(`Genuine ${brand} oil — the right oil for your engine, a new filter, and a fluid check with every change`);
  out.push(FALLBACK_HIGHLIGHTS[0]);
  const w = normalizeHoursWeek(week);
  if (!w[6].closed) out.push(`Open Saturdays — ${fmtClock(w[6].open)} to ${fmtClock(w[6].close)}, walk-ins welcome`);
  else out.push(FALLBACK_HIGHLIGHTS[1]);
  const wm = footer.match(/(\d+)\s*months?\s*(?:or|\/)\s*([\d,]+)\s*miles/i);
  if (wm) out.push(`Warranty on every repair — ${wm[1]} months or ${wm[2]} miles on parts and labor`);
  if (stats && stats.services >= 1000) out.push(`Trusted by our neighbors — ${stats.services.toLocaleString("en-US")}${stats.plus ? "+" : ""} services${stats.sinceYear ? ` since ${stats.sinceYear}` : ""}`);
  for (const f of FALLBACK_HIGHLIGHTS) if (out.length < 4 && !out.includes(f)) out.push(f);
  return out.slice(0, 4);
}

export const DEFAULT_FAQ = [
  { q: "Do I need an appointment?", a: "No. Oil changes and most quick services are first come, first served. For bigger repairs, request a time below and we'll call to confirm." },
  { q: "How long does an oil change take?", a: "Most are done in 15 to 20 minutes." },
  { q: "Will you do work I didn't approve?", a: "Never. You get a written estimate first, and we call you before doing anything that isn't on it." },
  { q: "Which oil does my car need?", a: "Use the price finder above, or tell us your year, make and model and we'll look it up." },
];

/* What each kind of service says when the owner hasn't written their own. */
const BLURBS = [
  [/oil/i, "Quick oil changes with the right oil for your engine, a new filter, and a fluid check."],
  [/brake fluid/i, "Old brake fluid absorbs water. A flush keeps your pedal firm and protects the system."],
  [/brake/i, "Pads, rotors, and a full brake inspection. We show you what we find before we fix anything."],
  [/tire/i, "New tires, rotations, flat repairs, and balancing."],
  [/cabin/i, "Fresh cabin filters keep dust and pollen out of the air you breathe."],
  [/air filter/i, "A clean engine air filter helps performance and fuel economy."],
  [/wiper/i, "New wiper blades installed while you wait."],
  [/trans/i, "Transmission fluid service to keep shifts smooth."],
  [/radiator|coolant/i, "Coolant flush and fill to protect against overheating."],
  [/fuel/i, "Fuel system cleaning for smoother running and better mileage."],
  [/steering/i, "Power steering fluid flush for easy, quiet steering."],
  [/diff/i, "Differential fluid service for trucks, SUVs, and all-wheel drive."],
];
export function serviceBlurb(name, overrides = {}) {
  if (str(overrides[name])) return str(overrides[name]);
  const hit = BLURBS.find(([re]) => re.test(name));
  return hit ? hit[1] : "";
}

/* Web address from a shop name: "Genie Auto Center" → "genie-auto-center". */
export function slugify(s) {
  return str(s)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/* ---------- hours ---------- */

const closedDay = () => ({ closed: true, open: "", close: "" });

/* Best-effort read of the free-text hours ("MON-FRI 8-6 SAT 8-5",
   "Mon–Fri 8am–6pm, Sat 8–2") into seven days, Sunday first. Anything it
   can't read stays closed; the owner corrects it in Settings. */
export function parseHoursText(text) {
  const week = DAYS.map(closedDay);
  const t = str(text).toLowerCase().replace(/[–—]/g, "-").replace(/\bto\b/g, "-");
  const dayIdx = (w) => DAYS.findIndex((d) => w.startsWith(d.toLowerCase()));
  const re = /([a-z]{3})[a-z]*\.?(?:\s*-\s*([a-z]{3})[a-z]*\.?)?[\s:,]*(\d{1,2})(?::(\d\d))?\s*(a|p)?\.?m?\.?\s*-\s*(\d{1,2})(?::(\d\d))?\s*(a|p)?\.?m?\.?/g;
  let m;
  while ((m = re.exec(t))) {
    const a = dayIdx(m[1]);
    const b = m[2] ? dayIdx(m[2]) : a;
    if (a < 0 || b < 0) continue;
    let oh = Number(m[3]);
    let ch = Number(m[6]);
    if (m[5] === "p" && oh < 12) oh += 12;
    if (m[8] === "p" && ch < 12) ch += 12;
    if (!m[8] && ch <= oh) ch += 12; // "8-6" means 8am to 6pm
    const hhmm = (h, mm) => `${String(h).padStart(2, "0")}:${mm || "00"}`;
    for (let i = a; ; i = (i + 1) % 7) {
      week[i] = { closed: false, open: hhmm(oh, m[4]), close: hhmm(ch, m[7]) };
      if (i === b) break;
    }
  }
  return week;
}

export function normalizeHoursWeek(week) {
  const w = Array.isArray(week) && week.length === 7 ? week : DAYS.map(closedDay);
  return w.map((d) => {
    const ok = d && !d.closed && /^\d\d:\d\d$/.test(d.open || "") && /^\d\d:\d\d$/.test(d.close || "");
    return ok ? { closed: false, open: d.open, close: d.close } : closedDay();
  });
}

export function fmtClock(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const ap = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}${ap}` : `${h12}${ap}`;
}

/* Rows for the hours table, with runs of identical days merged:
   [{ days: "Mon – Fri", text: "8am – 6pm" }, { days: "Sun", text: "Closed" }] */
export function hoursRows(week) {
  const w = normalizeHoursWeek(week);
  const order = [1, 2, 3, 4, 5, 6, 0]; // Monday first reads naturally
  const txt = (d) => (d.closed ? "Closed" : `${fmtClock(d.open)} – ${fmtClock(d.close)}`);
  const rows = [];
  for (const i of order) {
    const last = rows[rows.length - 1];
    if (last && last.text === txt(w[i])) last.to = i;
    else rows.push({ from: i, to: i, text: txt(w[i]) });
  }
  return rows.map((r) => ({ days: r.from === r.to ? DAYS[r.from] : `${DAYS[r.from]} – ${DAYS[r.to]}`, text: r.text }));
}

/* Open right now? `now` is { day: 0-6, minutes: since midnight } in the
   shop's own time zone (the page works that out). */
export function openStatus(week, now) {
  const w = normalizeHoursWeek(week);
  const mins = (hhmm) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  const today = w[now.day];
  if (!today.closed && now.minutes >= mins(today.open) && now.minutes < mins(today.close)) {
    return { open: true, text: `Open now · until ${fmtClock(today.close)}` };
  }
  for (let k = 0; k < 7; k++) {
    const i = (now.day + k) % 7;
    const d = w[i];
    if (d.closed) continue;
    if (k === 0 && now.minutes >= mins(d.open)) continue; // already closed for today
    const when = k === 0 ? "today" : k === 1 ? "tomorrow" : DAY_NAMES[i];
    return { open: false, text: `Closed · opens ${when} at ${fmtClock(d.open)}` };
  }
  return { open: false, text: "Closed" };
}

/* "How often" for a service page, from the shop's own Service Review
   table: a due-by interval, or checked-each-visit for filters and wipers. */
export function intervalText(row) {
  if (!row) return "";
  const mi = Number(row.miles) > 0 ? `${Number(row.miles).toLocaleString("en-US")} miles` : "";
  const mo = Number(row.months) > 0 ? (row.months % 12 === 0 ? `${row.months / 12 === 1 ? "year" : `${row.months / 12} years`}` : `${row.months} months`) : "";
  if (row.basis === "inspect") return `We check it at every visit and replace it when it's worn${mi ? `, usually around every ${mi}` : ""}.`;
  if (mi && mo) return `Every ${mi} or ${mo.startsWith("year") ? "1 " + mo : mo}, whichever comes first, unless your owner's manual says otherwise.`;
  if (mi || mo) return `Every ${mi || mo}, unless your owner's manual says otherwise.`;
  return "";
}

/* ---------- history stats ---------- */

/* "Since 2016" and a rounded-down service count from the invoice history.
   Rounded so the page doesn't need republishing every day to stay true. */
export function siteStats(orders) {
  let first = 0;
  let count = 0;
  for (const o of Object.values(orders || {})) {
    if (!o || o.status !== "invoiced") continue;
    count++;
    if (o.invoicedAt && (!first || o.invoicedAt < first)) first = o.invoicedAt;
  }
  const step = count >= 10000 ? 1000 : count >= 1000 ? 100 : count >= 100 ? 10 : 1;
  return { sinceYear: first ? new Date(first).getFullYear() : null, services: Math.floor(count / step) * step, plus: count % step !== 0 || step > 1 };
}

/* "Serving drivers since 2026" says nothing in 2026; keep the year only
   once it's history. */
function sinceBefore(stats, today) {
  const y = Number(String(today || "").slice(0, 4));
  return y && stats.sinceYear >= y ? { ...stats, sinceYear: null } : stats;
}

/* ---------- the oil change quote ---------- */

/* Which kind of engine a package or car is, so the quote doesn't offer a
   diesel oil change for a Civic or a Euro-spec oil for a pickup. */
const EURO_MAKES = /^(audi|bmw|mercedes|mercedes-benz|mini|porsche|volkswagen|vw|volvo|land rover|jaguar|saab|fiat|alfa romeo|smart|maserati|bentley|rolls-royce|polestar)$/i;
const DIESEL = /diesel|tdi|duramax|cummins|power ?stroke|ecodiesel|crd|bluetec/i;
export function packageKind(pkg) {
  const n = str(pkg && pkg.name);
  return /diesel/i.test(n) ? "d" : /euro/i.test(n) ? "e" : "";
}
/* Specs rarely say "diesel" in the engine name, so the grade and the sump
   give it away: 15W-40 is diesel oil, and no gas engine holds 10 quarts. */
export function carKind(make, engine, grade, quarts) {
  if (DIESEL.test(str(engine)) || /^15w-40/i.test(str(grade)) || Number(quarts) >= 10) return "d";
  return EURO_MAKES.test(str(make)) ? "e" : "";
}
/* The packages to quote for a car of that kind: a diesel gets the diesel
   packages, a European car the standard and Euro ones, anything else the
   standard ones. Falls back to every package rather than none. */
export function packagesFor(kinds, kind) {
  const idx = kinds.map((k, i) => i);
  const pick = idx.filter((i) => (kind === "d" ? kinds[i] === "d" : kinds[i] === "" || (kind === "e" && kinds[i] === "e")));
  return pick.length ? pick : idx;
}

/* The shop's own specs, trimmed to what the quote needs:
   [year, make, model, engine, grade, quarts, kind]. Sorted for the pickers. */
export function quoteVehicles(specs) {
  const rows = [];
  const seen = new Set();
  for (const s of Object.values(specs || {})) {
    if (!s || s.active === false) continue;
    const q = Number(s.oilCapacityQt);
    const y = Number(s.year);
    if (!q || !y || !str(s.make) || !str(s.model)) continue;
    const row = [y, str(s.make), str(s.model), str(s.engine), str(s.oilViscosity), round2(q), carKind(s.make, s.engine, s.oilViscosity, q)];
    const k = row.slice(0, 4).join("|").toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push(row);
  }
  return rows.sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]) || a[3].localeCompare(b[3]));
}

/* A package's price for so many quarts, the way the ticket charges it
   (oilPackageLines): the menu price covers the included quarts, and oil
   past that is the per-quart charge, by the tenth of a quart. */
export function packagePrice(pkg, quarts) {
  const q = Math.round((Number(quarts) || 0) * 10) / 10;
  const extra = round2(Math.max(0, q - (Number(pkg.quarts) || 0)));
  return round2((Number(pkg.price) || 0) + extra * (Number(pkg.extraQuart) || 0));
}

/* ---------- coupons ---------- */

function couponLive(c, today) {
  if (!c || c.active === false || c.deleted) return false;
  if (c.startsAt && today < c.startsAt) return false;
  if (c.endsAt && today > c.endsAt) return false;
  return true;
}
export function couponText(c) {
  const v = Number(c.value) || 0;
  return c.kind === "percent" ? `${v}% off` : `$${v % 1 ? v.toFixed(2) : v} off`;
}

/* A coupon's landing page address: #offer-fb20 */
export const offerSlug = (c) => slugify(c.code) || slugify(c.name) || String(c.id || "offer");

/* ---------- the payload ---------- */

/* Everything the public page shows. `today` is "YYYY-MM-DD" so expired
   coupons drop off at publish time (the page also hides them by date). */
export function sitePayload({ cfg, jobs, parts, coupons, orders, specs, today }) {
  const w = { ...DEFAULT_WEBSITE, ...(cfg.website || {}) };
  const week = normalizeHoursWeek(w.hoursWeek || parseHoursText(cfg.hours));
  const menu = (cfg.serviceMenu || []).filter((m) => str(m.name));
  const hidden = new Set(w.hiddenPackages || []);
  const pkgs = (cfg.oilPackages || []).filter((p) => str(p.name) && Number(p.price) > 0 && !hidden.has(p.id));

  const priced = w.showPrices
    ? Object.values(jobs || {})
        .filter((j) => j && j.portal && j.active !== false && !j.deleted)
        .map((j) => {
          const lines = jobLines(j, cfg, parts, uidOf, 1);
          const t = orderTotals({ lines, noSupplies: true }, { ...cfg, taxRate: 0 });
          return { name: str(j.name), category: str(j.category), price: round2(t.subtotal) };
        })
        .filter((j) => j.name && j.price > 0)
    : [];
  const norm = (s) => str(s).toLowerCase();
  const intervals = cfg.serviceIntervals && cfg.serviceIntervals.length ? cfg.serviceIntervals : DEFAULT_SERVICE_INTERVALS;
  const usedSlugs = new Set();
  const services = menu.map((m) => {
    const list = m.oil ? pkgs.map((p) => ({ name: str(p.name), price: round2(p.price) })) : priced.filter((j) => norm(j.category) === norm(m.category)).map((j) => ({ name: j.name, price: j.price }));
    const content = serviceContent(m.oil ? "oil change" : `${m.name} ${m.category || ""}`);
    let slug = slugify(m.name) || "service";
    while (usedSlugs.has(slug)) slug += "-2";
    usedSlugs.add(slug);
    return {
      name: m.name,
      slug,
      key: content.key,
      blurb: serviceBlurb(m.oil ? "oil change" : m.category || m.name, w.serviceBlurbs),
      from: w.showPrices && list.length ? Math.min(...list.map((x) => x.price)) : null,
      prices: w.showPrices && !m.oil ? list : [], // oil packages have their own cards
      /* every job and package this service covers, published or not, so a
         coupon that names any of them shows on this service's page */
      jobs: m.oil
        ? (cfg.oilPackages || []).map((p) => str(p.name)).filter(Boolean)
        : Object.values(jobs || {})
            .filter((j) => j && j.active !== false && !j.deleted && norm(j.category) === norm(m.category))
            .map((j) => str(j.name))
            .filter(Boolean),
      /* oil follows the reminder sticker the customer sees on the windshield */
      howOften: intervalText(
        content.key === "oil" && Number(cfg.reminderMiles) > 0
          ? { basis: "interval", miles: cfg.reminderMiles, months: cfg.reminderMonths }
          : intervals.find((r) => r && r.id === content.intervalId && r.enabled !== false)
      ),
      oil: !!m.oil,
      walkIn: !w.booking || (w.walkIn || []).includes(m.id), // first come, first served: no booking for this one
    };
  });

  const ids = new Set(w.couponIds || []);
  const deals = Object.values(coupons || {})
    .filter((c) => c && ids.has(c.id) && couponLive(c, today || ""))
    .map((c) => ({ title: str(c.name) || couponText(c), off: couponText(c), code: w.couponCodes ? str(c.code) : "", endsAt: c.endsAt || "", firstTimeOnly: !!c.firstTimeOnly, services: (c.requireAny || []).map(str).filter(Boolean) }));

  /* ad landing pages: any live coupon the owner gave a page, advertised on
     the main site or not; the code always shows, since that's the point */
  const offers = Object.entries(w.offers || {})
    .map(([id, o]) => [coupons && coupons[id], o || {}])
    .filter(([c]) => c && couponLive(c, today || ""))
    .map(([c, o]) => ({
      slug: offerSlug(c),
      title: str(c.name) || couponText(c),
      off: couponText(c),
      code: str(c.code),
      endsAt: c.endsAt || "",
      firstTimeOnly: !!c.firstTimeOnly,
      minSubtotal: Number(c.minSubtotal) || 0,
      services: (c.requireAny || []).map(str).filter(Boolean),
      headline: str(o.headline),
      blurb: str(o.blurb),
    }));

  return {
    v: 1,
    name: str(cfg.shopName),
    tagline: str(w.tagline),
    about: str(w.about),
    phone: str(cfg.shopPhone),
    email: str(cfg.shopEmail),
    address: str(cfg.shopAddress),
    cityLine: str(w.cityLine),
    logo: cfg.logo || "",
    heroPhoto: w.heroPhoto || "",
    brandColor: /^#[0-9a-f]{6}$/i.test(w.brandColor) ? w.brandColor : DEFAULT_WEBSITE.brandColor,
    accentColor: /^#[0-9a-f]{6}$/i.test(w.accentColor) ? w.accentColor : DEFAULT_WEBSITE.accentColor,
    ardNumber: str(cfg.ardNumber),
    timeZone: str(w.timeZone) || DEFAULT_WEBSITE.timeZone,
    hoursWeek: week,
    highlights: ((w.highlights || []).map(str).filter(Boolean).length ? w.highlights.map(str).filter(Boolean) : autoHighlights({ cfg, week, stats: siteStats(orders), pkgs })).map(splitHighlight),
    faq: (w.faq || []).filter((f) => f && str(f.q) && str(f.a)).length ? w.faq.filter((f) => f && str(f.q) && str(f.a)) : DEFAULT_FAQ,
    services,
    oilPackages: w.showPrices ? pkgs.map((p) => ({ name: str(p.name), price: round2(p.price), quarts: Number(p.quarts) || 5, extraQuart: round2(p.extraQuart || 0), details: str(p.details), kind: packageKind(p) })) : [],
    prices: priced.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
    deals,
    offers,
    stats: w.showStats ? sinceBefore(siteStats(orders), today) : null,
    vehicles: w.quoteTool && w.showPrices && pkgs.length ? quoteVehicles(specs) : [],
    booking: !!w.booking,
    links: { ...DEFAULT_WEBSITE.links, ...(w.links || {}) },
    taxNote: cfg.partsTaxable ? "Plus tax on parts." : "",
    updatedAt: Date.now(),
  };
}

/* ---------- appointment requests ---------- */

/* Checks the form before it's sent; the database re-checks the lengths. */
export function validateRequest(r) {
  const name = str(r.name);
  const phone = str(r.phone).replace(/[^\d+]/g, "");
  const email = str(r.email);
  if (!name) return "Please tell us your name.";
  if (name.length > 80) return "That name is too long.";
  if (phone.replace(/\D/g, "").length < 10 && !/^\S+@\S+\.\S+$/.test(email)) return "Leave a phone number or email so we can confirm.";
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return "That email doesn't look right.";
  if (str(r.note).length > 1000) return "Please keep the note under 1,000 characters.";
  return "";
}

/* Settings come back loose from the form; this is what gets saved. */
export function normalizeWebsite(w, shopName) {
  const x = { ...DEFAULT_WEBSITE, ...(w || {}) };
  const color = (c, dflt) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : dflt);
  return {
    ...x,
    enabled: !!x.enabled,
    slug: slugify(x.slug || shopName),
    tagline: str(x.tagline),
    about: str(x.about),
    cityLine: str(x.cityLine),
    brandColor: color(x.brandColor, DEFAULT_WEBSITE.brandColor),
    accentColor: color(x.accentColor, DEFAULT_WEBSITE.accentColor),
    highlights: (x.highlights || []).map(str).filter(Boolean).slice(0, 8),
    hoursWeek: x.hoursWeek ? normalizeHoursWeek(x.hoursWeek) : null,
    couponIds: [...new Set(x.couponIds || [])],
    hiddenPackages: [...new Set(x.hiddenPackages || [])],
    walkIn: [...new Set(x.walkIn || [])],
    offers: Object.fromEntries(Object.entries(x.offers || {}).map(([id, o]) => [id, { headline: str(o && o.headline), blurb: str(o && o.blurb) }])),
    faq: (x.faq || []).map((f) => ({ q: str(f && f.q), a: str(f && f.a) })).filter((f) => f.q && f.a),
    links: Object.fromEntries(Object.entries({ ...DEFAULT_WEBSITE.links, ...(x.links || {}) }).map(([k, v]) => [k, /^https?:\/\//i.test(str(v)) ? str(v) : str(v) ? "https://" + str(v) : ""])),
  };
}

/* The hours grid as one line of text, for the portal card and anywhere
   else the free-text hours show: "Mon – Fri 8am – 6pm, Sat 8am – 5pm". */
export function hoursText(week) {
  return hoursRows(week)
    .filter((r) => r.text !== "Closed")
    .map((r) => `${r.days} ${r.text}`)
    .join(", ");
}
