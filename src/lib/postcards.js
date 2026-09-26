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
import { photoUrl, SERVICE_CONTENT } from "./serviceContent.js";

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
    if (i === 0) st.on = true;
    return st;
  });
  return { ...DEFAULT_MAIL, ...saved, steps };
}
export const photoOf = (m) => (/^https:\/\//.test(str(m.photo)) ? str(m.photo) : photoUrl(str(m.photo) || PHOTO_LIBRARY[0].id, 1400));

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

/* → [{ customerId, step (0-2), dedupe: [keys], to, vars: { first_name, vehicle, due_date }, due }]
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
    if (had) {
      had.dedupe.push(key);
      if (due < had.due) Object.assign(had, { due, vars: { ...had.vars, vehicle: vehicleName(v), due_date: fmtDay(due) } });
      continue;
    }
    cards.set(g, { customerId: cid, step, dedupe: [key], to, due, vars: { first_name: str(c.first) || "there", vehicle: vehicleName(v), due_date: fmtDay(due) } });
  }
  return [...cards.values()].sort((a, b) => a.step - b.step || a.due - b.due);
}

/* ---------- the card ---------- */

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
export function renderPostcard(cfg, coupons, opts = {}, stepIndex = 0) {
  const m = mailOf(cfg);
  const st = m.steps[stepIndex] || m.steps[0];
  const w = (cfg && cfg.website) || {};
  const main = /^#[0-9a-f]{6}$/i.test(w.brandColor || "") ? w.brandColor : "#8e2f2f";
  const home = siteHome(cfg, opts.appBase);
  const list = st.couponIds.map((id) => coupons && coupons[id]).filter(Boolean);
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
    .map((x) => `<div class="code"><div><b class="d">${esc(couponText(x).toUpperCase())}</b>${lineOf(x) && list.length > 1 ? `<i>${esc(lineOf(x))}</i>` : ""}</div>${str(x.code) ? `<span>${esc(x.code)}</span>` : ""}</div>`)
    .join("");

  const front = `<!DOCTYPE html><html><head><meta charset="utf-8">${font}<style>${base}
.f{position:relative;width:6.25in;height:4.25in;overflow:hidden;background:#121417 url('${esc(photo)}') center/cover no-repeat}
.f:before{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(12,13,15,.9) 0%,rgba(12,13,15,.6) 55%,rgba(12,13,15,.1) 100%),linear-gradient(0deg,rgba(12,13,15,.85) 0%,transparent 45%)}
.in{position:absolute;left:.4in;top:.38in;right:.4in;bottom:.42in;color:#fff;display:flex;flex-direction:column;align-items:flex-start}
.logo{display:inline-block;background:#fff;border-radius:.08in;padding:.05in .1in}.logo img{height:.46in;display:block}
.name{font-size:.3in;font-weight:800}
h1{font-size:.72in;line-height:.88;margin:auto 0 .12in;max-width:3.9in}
.sub{font-size:.15in;font-weight:600;color:rgba(255,255,255,.9)}
.tag{position:absolute;right:0;top:.05in;background:#fff;color:${main};border:.04in dashed ${main};border-radius:.12in;padding:.1in .16in;text-align:center;transform:rotate(3deg)}
.tag b{display:block;font-size:.5in;line-height:.95}.tag span{display:block;font-size:.12in;font-weight:700;color:#15171b;max-width:1.5in}
.bar{position:absolute;left:0;right:0;bottom:0;height:.1in;background:${main}}
</style></head><body><div class="f"><div class="in">
${logo ? `<span class="logo"><img src="${esc(logo)}" alt=""></span>` : `<div class="name d">${esc(cfg.shopName)}</div>`}
${off ? `<div class="tag"><b class="d">${esc(off)}</b>${line ? `<span class="d">${esc(line)}</span>` : ""}</div>` : ""}
<h1 class="d">${esc(st.headline)}</h1>
<p class="sub">No appointment needed${str(cfg.shopPhone) ? ` · ${esc(cfg.shopPhone)}` : ""}${home && w.domain ? ` · ${esc(str(w.domain).replace(/^www\./, ""))}` : ""}</p>
</div><div class="bar"></div></div></body></html>`;

  const back = `<!DOCTYPE html><html><head><meta charset="utf-8">${font}<style>${base}
.b{position:relative;width:6.25in;height:4.25in;background:#fff}
.col{position:absolute;left:.35in;top:.35in;width:2.25in;bottom:.35in;display:flex;flex-direction:column}
.hi{font-size:${list.length > 1 ? ".115in" : ".13in"};line-height:1.4;color:#33373d}
.codes{margin:.1in 0 .08in;display:grid;gap:.05in}
.code{border:.03in dashed ${main};border-radius:.08in;padding:.05in .09in;display:flex;align-items:center;justify-content:space-between;gap:.06in}
.code b{display:block;font-size:${list.length > 1 ? ".2in" : ".3in"};line-height:1;color:${main}}.code i{display:block;font-style:normal;font-size:.075in;font-weight:700;text-transform:uppercase;color:#33373d;margin-top:.01in}
.code span{font:700 ${list.length > 1 ? ".12in" : ".17in"} "Courier New",monospace;letter-spacing:.03in;background:#15171b;color:#fff;padding:.03in .07in;border-radius:.05in;white-space:nowrap}
.qr{display:flex;gap:.1in;align-items:center;margin-top:auto}.qr div{width:.78in;height:.78in}.qr svg{width:100%;height:100%}
.qr p{font-size:.1in;line-height:1.35;color:#5b616c}.qr p b{color:#15171b;font-size:.12in}
.shop{font-size:.1in;line-height:1.4;color:#5b616c;margin-top:.08in}.shop b{color:#15171b;font-size:.12in}
.top{position:absolute;left:3.3in;top:.35in;right:.35in;height:1.05in;border-left:.02in solid #e7e3dc;padding-left:.15in}
.top .d{font-size:.26in;line-height:.95;color:${main}}.top p{font-size:.1in;color:#5b616c;margin-top:.05in}
</style></head><body><div class="b">
<div class="col">
<p class="hi">${esc(st.message).replace(/\n/g, "<br>")}</p>
${list.length ? `<div class="codes">${couponRows}</div><p class="hi" style="font-size:.1in">Bring this card or mention the code${list.length > 1 ? "s. One per visit" : ""}${ends ? `. Ends ${esc(ends)}` : ""}.</p>` : ""}
${qrUrl ? `<div class="qr"><div>${qrSvg(qrUrl)}</div><p><b>Scan with your phone</b><br>${c ? "for your coupon, hours, and directions" : "for hours, prices, and directions"}</p></div>` : ""}
<div class="shop"><b>${esc(cfg.shopName)}</b><br>${esc(addr)}${str(cfg.shopPhone) ? ` · ${esc(cfg.shopPhone)}` : ""}${hours ? `<br>${esc(hours)}` : ""}</div>
</div>
<div class="top"><div class="d">${stepIndex ? "Was due" : "Due around"}<br>{due_date}</div><p>{vehicle}</p></div>
</div></body></html>`;

  return { front, back, qrUrl };
}
