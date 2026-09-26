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

export const DEFAULT_MAIL = {
  on: false,
  couponId: "",
  headline: "Time for an oil change",
  message: "Hi {first_name}, your {vehicle} is due for its next oil change around {due_date}. No appointment needed. Just pull in any time we're open.",
  aheadDays: 12, // mail cards for sticker dates up to this many days out
  costPerCard: 0.85, // for the estimate the owner sees before mailing
};
export const mailOf = (cfg) => ({ ...DEFAULT_MAIL, ...((cfg && cfg.mail) || {}) });

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

/* → [{ customerId, dedupe: [keys], to, vars: { first_name, vehicle, due_date }, due }]
   mailed: Set of dedupe keys already mailed */
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
  const byCustomer = new Map();
  for (const [vid, list] of Object.entries(byVehicle)) {
    const v = vehicles[vid];
    if (!v || v.active === false) continue;
    list.sort((a, b) => b.invoicedAt - a.invoicedAt);
    const last = list.find((o) => isOilOrder(o, pkgNames));
    if (!last) continue;
    const due = addMonths(last.invoicedAt, months);
    if (due < now - 7 * DAY || due > now + ahead * DAY) continue;
    const key = `card:oil:${vid}:${last.id}`;
    if (done.has(key)) continue;
    const cid = v.customerId || last.customerId;
    const c = customers[cid];
    if (!c || c.active === false || c.mailOptOut) continue;
    const to = mailingAddress(c, shopStreet);
    if (!to) continue;
    /* one card per customer, naming the car that's due first */
    const had = byCustomer.get(cid);
    if (had) {
      had.dedupe.push(key);
      if (due < had.due) Object.assign(had, { due, vars: { ...had.vars, vehicle: vehicleName(v), due_date: fmtDay(due) } });
      continue;
    }
    byCustomer.set(cid, { customerId: cid, dedupe: [key], to, due, vars: { first_name: str(c.first) || "there", vehicle: vehicleName(v), due_date: fmtDay(due) } });
  }
  return [...byCustomer.values()].sort((a, b) => a.due - b.due);
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
export function renderPostcard(cfg, coupons, opts = {}) {
  const m = mailOf(cfg);
  const w = (cfg && cfg.website) || {};
  const main = /^#[0-9a-f]{6}$/i.test(w.brandColor || "") ? w.brandColor : "#8e2f2f";
  const home = siteHome(cfg, opts.appBase);
  const c = m.couponId && coupons ? coupons[m.couponId] : null;
  const off = c ? couponText(c).toUpperCase() : "";
  const line = c ? str(c.name).replace(/^\$?\d+(\.\d+)?%?\s*off\b[\s:,-]*/i, "") : "";
  const offerUrl = c && w.offers && w.offers[c.id] && home ? `${home}${home.includes("?") ? "&" : "?"}offer=${encodeURIComponent(offerSlug(c))}` : "";
  const qrUrl = offerUrl || home;
  const logo = /^https?:\/\//.test(str(cfg.logo)) ? str(cfg.logo) : str(opts.logoUrl);
  const photo = photoUrl((SERVICE_CONTENT.find((x) => x.key === "oil") || {}).photo.id, 1400);
  const addr = [str(cfg.shopAddress), str(w.cityLine)].filter(Boolean).join(", ");
  const hours = w.hoursWeek ? hoursRows(w.hoursWeek).map((r) => `${r.days} ${r.text}`).join(" · ") : str(cfg.hours);
  const font = `<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Inter:wght@400;600;700&display=block" rel="stylesheet">`;
  const base = `*{box-sizing:border-box;margin:0;padding:0}html,body{width:6.25in;height:4.25in}body{font-family:Inter,Arial,sans-serif;color:#15171b;-webkit-print-color-adjust:exact;print-color-adjust:exact}.d{font-family:"Barlow Condensed","Arial Narrow",Impact,sans-serif;text-transform:uppercase;letter-spacing:.01em}`;

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
<h1 class="d">${esc(m.headline)}</h1>
<p class="sub">No appointment needed${str(cfg.shopPhone) ? ` · ${esc(cfg.shopPhone)}` : ""}${home && w.domain ? ` · ${esc(str(w.domain).replace(/^www\./, ""))}` : ""}</p>
</div><div class="bar"></div></div></body></html>`;

  const back = `<!DOCTYPE html><html><head><meta charset="utf-8">${font}<style>${base}
.b{position:relative;width:6.25in;height:4.25in;background:#fff}
.col{position:absolute;left:.35in;top:.35in;width:2.25in;bottom:.35in;display:flex;flex-direction:column}
.hi{font-size:.13in;line-height:1.45;color:#33373d}
.code{margin:.12in 0 .1in;border:.03in dashed ${main};border-radius:.08in;padding:.07in .1in;display:flex;align-items:center;justify-content:space-between}
.code b{font-size:.3in;color:${main}}.code span{font:700 .17in "Courier New",monospace;letter-spacing:.04in;background:#15171b;color:#fff;padding:.03in .08in;border-radius:.05in}
.qr{display:flex;gap:.1in;align-items:center;margin-top:auto}.qr div{width:.78in;height:.78in}.qr svg{width:100%;height:100%}
.qr p{font-size:.1in;line-height:1.35;color:#5b616c}.qr p b{color:#15171b;font-size:.12in}
.shop{font-size:.1in;line-height:1.4;color:#5b616c;margin-top:.08in}.shop b{color:#15171b;font-size:.12in}
.top{position:absolute;left:3.3in;top:.35in;right:.35in;height:1.05in;border-left:.02in solid #e7e3dc;padding-left:.15in}
.top .d{font-size:.26in;line-height:.95;color:${main}}.top p{font-size:.1in;color:#5b616c;margin-top:.05in}
</style></head><body><div class="b">
<div class="col">
<p class="hi">${esc(m.message).replace(/\n/g, "<br>")}</p>
${c ? `<div class="code"><b class="d">${esc(off)}</b>${str(c.code) ? `<span>${esc(c.code)}</span>` : ""}</div><p class="hi" style="font-size:.1in">Bring this card or mention the code${c.endsAt ? `. Ends ${esc(c.endsAt)}` : ""}.</p>` : ""}
${qrUrl ? `<div class="qr"><div>${qrSvg(qrUrl)}</div><p><b>Scan with your phone</b><br>${c ? "for your coupon, hours, and directions" : "for hours, prices, and directions"}</p></div>` : ""}
<div class="shop"><b>${esc(cfg.shopName)}</b><br>${esc(addr)}${str(cfg.shopPhone) ? ` · ${esc(cfg.shopPhone)}` : ""}${hours ? `<br>${esc(hours)}` : ""}</div>
</div>
<div class="top"><div class="d">Due around<br>{due_date}</div><p>{vehicle}</p></div>
</div></body></html>`;

  return { front, back, qrUrl };
}
