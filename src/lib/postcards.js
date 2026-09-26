/* Oil change reminder postcards: who gets one in this week's batch, and the
   card itself (4x6, front and back, as HTML for Lob's printers). Pure — no
   React, no storage, no mailing.

   A card goes out about a week before the date on the customer's window
   sticker, so it arrives in time. The owner approves a batch once a week;
   the window reaches a week back too, so a skipped week isn't a missed
   customer. Every card has a `dedupe` key the server won't mail twice. */
import qrcode from "qrcode-generator";
import { isOilOrder, fmtDay, vehicleName, addMonths } from "./emailAutomations.js";
import { siteHome } from "./emailCompose.js";
import { offerSlug, couponText, hoursRows } from "./website.js";
import { SERVICE_CONTENT } from "./serviceContent.js";

const DAY = 86400000;
const str = (s) => String(s == null ? "" : s).trim();
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* The reminder series for one oil change: card 1 around the sticker date;
   cards 2 and 3 only if the car still hasn't been back that many days
   after it (each needs the one before it to have gone out). A new oil
   change starts the next sticker date over at card 1. */
export const DEFAULT_STEPS = [
  { on: true, afterDays: 0, headline: "Time for an oil change", message: "Hi {first_name}, your {vehicle} is due for its next oil change around {due_date}. No appointment needed. Just pull in any time we're open.", couponIds: [] },
  { on: false, afterDays: 21, headline: "Still due for an oil change?", message: "Hi {first_name}, your {vehicle} was due for an oil change around {due_date}. Here's a little extra to bring you in.", couponIds: [] },
  { on: false, afterDays: 42, headline: "Don't wait on your oil change", message: "Hi {first_name}, your {vehicle} is well past due since {due_date}. Here's our best offer to get you back on schedule.", couponIds: [] },
];
export const STEP_LABELS = ["1st card", "2nd card", "3rd card"];

/* Background photos to pick from; the shop can also upload its own. */
export const PHOTO_LIBRARY = [
  ["oil", "Oil change"],
  ["general", "Mechanic at work"],
  ["coolant", "Under the hood"],
  ["tires", "Tires"],
  ["brakes", "Brakes"],
  ["trans", "Shifter"],
  ["steering", "Behind the wheel"],
].map(([key, label]) => {
  const c = key === "general" ? { photo: { id: "1625047509248-ec889cbff17f" } } : SERVICE_CONTENT.find((x) => x.key === key);
  return { id: c.photo.id, label };
});

export const DEFAULT_MAIL = {
  photo: "", // an Unsplash photo id from PHOTO_LIBRARY, or an https:// address of the shop's own photo
  aheadDays: 12, // card 1: sticker dates up to this many days out
  costPerCard: 0.85, // for the estimate the owner sees before mailing
  steps: DEFAULT_STEPS,
};
export function mailOf(cfg) {
  const saved = (cfg && cfg.mail) || {};
  const steps = DEFAULT_STEPS.map((d, i) => {
    const st = { ...d, ...((saved.steps || [])[i] || {}) };
    /* settings from before the series: one card with one coupon */
    if (i === 0 && !saved.steps) {
      if (saved.headline) st.headline = saved.headline;
      if (saved.message) st.message = saved.message;
      if (saved.couponId) st.couponIds = [saved.couponId];
    }
    st.couponIds = (st.couponIds || []).filter(Boolean).slice(0, 3);
    st.byOil = Object.fromEntries(OIL_TYPES.map(([k]) => [k, ((st.byOil || {})[k] || []).filter(Boolean).slice(0, 3)]));
    if (i === 0) st.on = true;
    return st;
  });
  return { ...DEFAULT_MAIL, ...saved, steps };
}
/* The front photo at exactly the card's shape and print size, as a plain
   JPEG: Lob's older renderer can't draw WebP/AVIF, which a format-by-browser
   request might get. Uploads are cropped to the same shape when added. */
export const cardPhotoUrl = (id) => `https://images.unsplash.com/photo-${id}?w=1875&h=1275&fit=crop&crop=entropy&fm=jpg&q=80`;
export const photoOf = (m) => (/^https:\/\//.test(str(m.photo)) ? str(m.photo) : cardPhotoUrl(str(m.photo) || PHOTO_LIBRARY[0].id));

/* ---------- which oil the car gets ---------- */

/* From the last oil change's lines, as the desk and the imported LubeSoft
   history word them ("Valv Synpower Sae 0W20", "Synthetic Blend Charge",
   "Valv Prem Conv Sae 5W30", "Customer's Motor Oil"). Other fluids on the
   same ticket (Max-Life ATF is transmission fluid) and extra-quart and
   coupon lines are ignored. */
export const OIL_TYPES = [
  ["synthetic", "Full synthetic"],
  ["blend", "Synthetic blend / high mileage"],
  ["conventional", "Conventional"],
];
export function oilTypeOf(order) {
  const t = (order && order.lines ? order.lines : [])
    .filter((l) => l.kind !== "note" && l.kind !== "discount")
    .map((l) => `${l.job || ""}: ${l.description || ""}`)
    .filter((x) => !/extra oil over|coupon|\batf\b|trans|differential|gear oil|power steering|brake fluid|coolant/i.test(x))
    .join(" | ");
  if (/customer'?s (motor )?oil/i.test(t)) return "own";
  if (/blend|max-?life(?! atf)/i.test(t) && !/full syn/i.test(t)) return "blend";
  if (/synth|synpo?w|\bsyn\b|full syn/i.test(t)) return "synthetic";
  if (/\bconv|conventional|prem(ium)? blue/i.test(t)) return "conventional";
  return "";
}

/* The coupons a card carries for a car on this oil: its oil type's own
   list when the shop set one, otherwise the card's regular coupons. */
export function couponIdsFor(step, oil) {
  const own = step && step.byOil && oil && step.byOil[oil];
  return (own && own.length ? own : (step && step.couponIds) || []).filter(Boolean).slice(0, 3);
}

/* ---------- addresses ---------- */

const WORDS = { north: "n", south: "s", east: "e", west: "w", street: "st", avenue: "ave", road: "rd", boulevard: "blvd", drive: "dr", lane: "ln", court: "ct", place: "pl", parkway: "pkwy", highway: "hwy", suite: "ste", apartment: "apt" };
const normStreet = (s) =>
  str(s)
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => WORDS[w] || w)
    .join(" ");

/* A mailable US address, or null. `shop` is the shop's own address, which
   some records carry as a placeholder and must never be mailed to. */
export function mailingAddress(c, shopStreet = "") {
  if (!c) return null;
  const street = str(c.street);
  const city = str(c.city);
  const state = str(c.state).toUpperCase();
  const zip = str(c.zip);
  if (!street || !city || !/^[A-Z]{2}$/.test(state) || !/^\d{5}(-?\d{4})?$/.test(zip)) return null;
  if (!/\d/.test(street)) return null; // "unknown", "same", "n/a"…
  if (shopStreet && normStreet(street) === normStreet(shopStreet)) return null;
  const name = [str(c.first), str(c.last)].filter(Boolean).join(" ") || str(c.company);
  if (!name) return null;
  return { name: name.slice(0, 40), address_line1: street.slice(0, 64), address_city: city.slice(0, 200), address_state: state, address_zip: zip, address_country: "US" };
}

/* ---------- this week's batch ---------- */

/* → [{ customerId, step (0-2), oil, dedupe: [keys], to, vars: { first_name, vehicle, due_date }, due }]
   mailed: Set of dedupe keys already mailed */
export const stepKey = (vid, orderId, step) => `card:oil:${vid}:${orderId}${step ? `:s${step + 1}` : ""}`;
export function duePostcards({ cfg, customers, vehicles, orders, mailed, now = Date.now() }) {
  const m = mailOf(cfg);
  const months = Number(cfg.reminderMonths) || 3;
  const ahead = Math.max(3, Number(m.aheadDays) || 12);
  const done = mailed || new Set();
  const pkgNames = new Set((cfg.oilPackages || []).map((p) => str(p.name).toLowerCase()).filter(Boolean));
  const shopStreet = str(cfg.shopAddress).split(",")[0];

  const byVehicle = {};
  for (const o of Object.values(orders || {})) {
    if (!o || o.status !== "invoiced" || !o.invoicedAt || !o.vehicleId) continue;
    (byVehicle[o.vehicleId] = byVehicle[o.vehicleId] || []).push(o);
  }
  const cards = new Map();
  for (const [vid, list] of Object.entries(byVehicle)) {
    const v = vehicles[vid];
    if (!v || v.active === false) continue;
    list.sort((a, b) => b.invoicedAt - a.invoicedAt);
    const last = list.find((o) => isOilOrder(o, pkgNames));
    if (!last) continue;
    const due = addMonths(last.invoicedAt, months);
    /* which card in the series this car is ready for, if any */
    let step = -1;
    if (due >= now - 7 * DAY && due <= now + ahead * DAY && !done.has(stepKey(vid, last.id, 0))) step = 0;
    for (let k = 1; k < m.steps.length && step < 0; k++) {
      const st = m.steps[k];
      if (!st.on) continue;
      const at = due + (Number(st.afterDays) || 0) * DAY;
      if (now < at || now > at + 14 * DAY) continue;
      if (done.has(stepKey(vid, last.id, k)) || !done.has(stepKey(vid, last.id, k - 1))) continue;
      step = k;
    }
    if (step < 0) continue;
    const cid = v.customerId || last.customerId;
    const c = customers[cid];
    if (!c || c.active === false || c.mailOptOut) continue;
    const to = mailingAddress(c, shopStreet);
    if (!to) continue;
    /* one card per customer per step, naming the car that's due first */
    const key = stepKey(vid, last.id, step);
    const g = `${cid}|${step}`;
    const had = cards.get(g);
    const oil = oilTypeOf(last);
    if (had) {
      had.dedupe.push(key);
      if (due < had.due) Object.assign(had, { due, oil, vars: { ...had.vars, vehicle: vehicleName(v), due_date: fmtDay(due) } });
      continue;
    }
    cards.set(g, { customerId: cid, step, oil, dedupe: [key], to, due, vars: { first_name: str(c.first) || "there", vehicle: vehicleName(v), due_date: fmtDay(due) } });
  }
  return [...cards.values()].sort((a, b) => a.step - b.step || a.due - b.due);
}

/* ---------- the card ---------- */

/* The dark shade over the front photo, so the white headline reads. Lob's
   renderer turns see-through CSS gradients into solid black, so the fade is
   built from thin strips of plain see-through color instead: darker on the
   left where the headline sits, and darker toward the bottom. */
const SHADE = (() => {
  let h = "";
  const cols = 10;
  for (let i = 0; i < cols; i++) {
    const a = (0.62 - i * 0.05).toFixed(3); // left .62 → right .17
    h += `<div class="sv" style="left:${((6.25 / cols) * i).toFixed(3)}in;width:${(6.25 / cols + 0.01).toFixed(3)}in;background:rgba(12,13,15,${a})"></div>`;
  }
  /* the bottom: overlapping bands, each a little shorter, so it darkens toward the bottom edge */
  const rows = 8;
  for (let i = 0; i < rows; i++) h += `<div class="sh" style="bottom:0;height:${(0.28 * (rows - i)).toFixed(2)}in;background:rgba(12,13,15,.07)"></div>`;
  return h;
})();

/* The QR code as one compact path, dark squares merged into runs along
   each row: a fraction of the size of the library's own SVG, which
   matters because Lob takes at most 10,000 characters per side. */
export function qrSvg(url) {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      let run = 1;
      while (c + run < n && qr.isDark(r, c + run)) run++;
      d += `M${c} ${r}h${run}v1h-${run}z`;
      c += run - 1;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><path d="${d}"/></svg>`;
}

/* The card's two sides as HTML at 6.25" x 4.25" (4x6 plus 1/8" bleed).
   Placeholders {first_name} {vehicle} {due_date} are filled per card by the
   server. The back's lower right is left empty: Lob prints the address and
   postage there. */
export function renderPostcard(cfg, coupons, opts = {}, stepIndex = 0, oil = "") {
  const m = mailOf(cfg);
  const st = m.steps[stepIndex] || m.steps[0];
  const w = (cfg && cfg.website) || {};
  const main = /^#[0-9a-f]{6}$/i.test(w.brandColor || "") ? w.brandColor : "#8e2f2f";
  const home = siteHome(cfg, opts.appBase);
  const list = couponIdsFor(st, oil).map((id) => coupons && coupons[id]).filter(Boolean);
  const c = list[0] || null;
  const off = c ? couponText(c).toUpperCase() : "";
  const lineOf = (x) => str(x.name).replace(/^\$?\d+(\.\d+)?%?\s*off\b[\s:,-]*/i, "");
  const line = c ? lineOf(c) : "";
  const offerUrl = c && w.offers && w.offers[c.id] && home ? `${home}${home.includes("?") ? "&" : "?"}offer=${encodeURIComponent(offerSlug(c))}` : "";
  const qrUrl = offerUrl || home;
  const logo = /^https?:\/\//.test(str(cfg.logo)) ? str(cfg.logo) : str(opts.logoUrl);
  const photo = photoOf(m);
  const addr = [str(cfg.shopAddress), str(w.cityLine)].filter(Boolean).join(", ");
  const hours = w.hoursWeek ? hoursRows(w.hoursWeek).map((r) => `${r.days} ${r.text}`).join(" · ") : str(cfg.hours);
  const font = `<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Inter:wght@400;600;700&display=block" rel="stylesheet">`;
  const base = `*{box-sizing:border-box;margin:0;padding:0}html,body{width:6.25in;height:4.25in}body{font-family:Inter,Arial,sans-serif;color:#15171b;-webkit-print-color-adjust:exact;print-color-adjust:exact}.d{font-family:"Barlow Condensed","Arial Narrow",Impact,sans-serif;text-transform:uppercase;letter-spacing:.01em}`;
  const ends = list.map((x) => x.endsAt).filter(Boolean).sort()[0] || "";
  const couponRows = list
    .map((x) => `<table class="code"><tr><td><b class="d">${esc(couponText(x).toUpperCase())}</b>${lineOf(x) && list.length > 1 ? `<i>${esc(lineOf(x))}</i>` : ""}</td>${str(x.code) ? `<td style="text-align:right;vertical-align:bottom"><span>CODE ${esc(x.code)}</span></td>` : ""}</tr></table>`)
    .join("");

  /* Lob draws cards with an older WebKit engine: no flexbox, grid, `inset`
     or unprefixed transforms. Everything here is absolute positioning,
     tables, and -webkit- prefixes so the proof and the print match what
     the desk shows. The dark shade is a real element, not a pseudo one. */
  const front = `<!DOCTYPE html><html><head><meta charset="utf-8">${font}<style>${base}
.f{position:relative;width:6.25in;height:4.25in;overflow:hidden;background:#121417}
.ph{position:absolute;left:0;top:0;width:6.25in;height:4.25in;display:block}
.sv{position:absolute;top:0;height:4.25in}.sh{position:absolute;left:0;width:6.25in}
.logo{position:absolute;left:.4in;top:.38in;background:#fff;border-radius:.08in;padding:.05in .1in}.logo img{height:.46in;display:block}
.name{position:absolute;left:.4in;top:.4in;color:#fff;font-size:.3in;font-weight:800}
.txt{position:absolute;left:.4in;bottom:.46in;width:3.2in;color:#fff}
h1{font-size:.66in;line-height:.9;margin:0 0 .1in}
.sub{font-size:.14in;font-weight:600;color:#fff}
.tag{position:absolute;right:.32in;top:.3in;width:2.35in;background:${main};color:#fff;border-radius:.16in;padding:.07in;-webkit-transform:rotate(4deg);transform:rotate(4deg);-webkit-box-shadow:0 .06in .2in rgba(0,0,0,.45);box-shadow:0 .06in .2in rgba(0,0,0,.45)}
.tag .in{border:.035in dashed rgba(255,255,255,.85);border-radius:.11in;padding:.1in .08in .12in;text-align:center}
.tag .off{display:block;font-size:${off.length > 8 ? ".62in" : ".82in"};line-height:.9}
.tag .ln{display:block;font-size:.15in;line-height:1.1;margin-top:.04in}
.tag .cd{display:block;margin-top:.06in;font:600 .085in Inter,Arial,sans-serif;letter-spacing:.02in;color:rgba(255,255,255,.8)}
.bar{position:absolute;left:0;bottom:0;width:6.25in;height:.1in;background:${main}}
</style></head><body><div class="f"><img class="ph" src="${esc(photo)}" alt="">${SHADE}
${logo ? `<div class="logo"><img src="${esc(logo)}" alt=""></div>` : `<div class="name d">${esc(cfg.shopName)}</div>`}
${off ? `<div class="tag"><div class="in"><b class="off d">${esc(off)}</b>${line ? `<span class="ln d">${esc(line)}</span>` : ""}${str(c.code) ? `<span class="cd">CODE ${esc(c.code)}</span>` : ""}</div></div>` : ""}
<div class="txt"><h1 class="d">${esc(st.headline)}</h1>
<p class="sub">No appointment needed${str(cfg.shopPhone) ? ` · ${esc(cfg.shopPhone)}` : ""}${home && w.domain ? ` · ${esc(str(w.domain).replace(/^www\./, ""))}` : ""}</p></div>
<div class="bar"></div></div></body></html>`;

  const back = `<!DOCTYPE html><html><head><meta charset="utf-8">${font}<style>${base}
.b{position:relative;width:6.25in;height:4.25in;background:#fff}
.col{position:absolute;left:.35in;top:.35in;width:2.25in}
.hi{font-size:${list.length > 2 ? ".105in" : list.length > 1 ? ".115in" : ".13in"};line-height:1.4;color:#33373d}
.code{width:100%;border-collapse:separate;border:.03in dashed ${main};border-radius:.08in;margin-top:.05in}
.code td{padding:.04in .08in;vertical-align:middle}
.code b{display:block;font-size:${list.length > 1 ? ".2in" : ".3in"};line-height:1;color:${main}}.code i{display:block;font-style:normal;font-size:.075in;font-weight:700;text-transform:uppercase;color:#33373d;margin-top:.01in}
.code span{font:600 .075in Inter,Arial,sans-serif;letter-spacing:.015in;color:#7a7f87;white-space:nowrap}
.codes{margin:.08in 0 .06in}
.qrt{width:100%;border-collapse:collapse}.qrt td{vertical-align:top;padding:0}
.qrc{width:.8in;text-align:center}.qrc svg{width:.8in;height:.8in;display:block}.qrc p{font-size:.075in;line-height:1.2;color:#5b616c;margin-top:.03in}
.shop{position:absolute;left:.35in;bottom:.3in;width:2.25in;font-size:.1in;line-height:1.4;color:#5b616c}.shop b{color:#15171b;font-size:.12in}
.top{position:absolute;left:3.3in;top:.3in;width:2.6in;height:1.2in;border-left:.02in solid #e7e3dc;padding-left:.15in}
.top .d{font-size:.26in;line-height:.95;color:${main}}.top p{font-size:.1in;color:#5b616c;margin-top:.05in}
</style></head><body><div class="b">
<div class="col">
<p class="hi">${esc(st.message).replace(/\n/g, "<br>")}</p>
${list.length ? `<div class="codes">${couponRows}</div><p class="hi" style="font-size:.1in">Bring this card or mention the code${list.length > 1 ? "s. One per visit" : ""}${ends ? `. Ends ${esc(ends)}` : ""}.</p>` : ""}
</div>
<div class="shop"><b>${esc(cfg.shopName)}</b><br>${esc(addr)}${str(cfg.shopPhone) ? ` · ${esc(cfg.shopPhone)}` : ""}${hours ? `<br>${esc(hours)}` : ""}</div>
<div class="top"><table class="qrt"><tr><td><div class="d">${stepIndex ? "Was due" : "Due around"}<br>{due_date}</div><p>{vehicle}</p></td>${qrUrl ? `<td class="qrc">${qrSvg(qrUrl)}<p>Scan for ${c ? "your coupon" : "hours &amp; directions"}</p></td>` : ""}</tr></table></div>
</div></body></html>`;

  return { front, back, qrUrl };
}
