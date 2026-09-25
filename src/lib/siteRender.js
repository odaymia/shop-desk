/* The shop's public website as one self-contained HTML document, built from
   sitePayload() (src/lib/website.js). Pure — returns a string. The same page
   is served live at /site/?s=<slug>, shown in the Settings preview, and
   downloaded as index.html for a shop that hosts on its own domain. Because
   the content is in the HTML itself (not fetched after load), Google reads
   it, and the JSON-LD block tells search engines it's an auto repair shop.

   opts:
     api       { url, key, shopId } — where the booking form posts; null = preview
     portalUrl link to the customer portal; blank hides it
     preview   true in the Settings preview (form doesn't send) */
import { hoursRows, DAY_NAMES } from "./website.js";

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const money = (n) => "$" + (Number(n) || 0).toFixed(2).replace(/\.00$/, "");
const telHref = (p) => "tel:" + String(p || "").replace(/[^\d+]/g, "");
/* JSON inside <script>: never let a value close the tag */
const jsonForScript = (v) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, " ");
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "").trim()) ? String(u).trim() : "");
const safeImg = (u) => (/^(https?:\/\/|data:image\/(png|jpe?g|webp|gif);base64,|[\w.][\w./-]*$)/i.test(String(u || "")) ? String(u) : "");

/* Default headline: the shop's first few services and its city. */
export function defaultTagline(p) {
  const names = (p.services || []).slice(0, 3).map((s) => s.name.toLowerCase());
  const list = names.length > 1 ? names.slice(0, -1).join(", ") + " & " + names[names.length - 1] : names[0] || "auto service";
  const city = (p.cityLine || "").split(",")[0].trim();
  return list.charAt(0).toUpperCase() + list.slice(1) + (city ? ` in ${city}` : "") + ", done right.";
}
export function defaultAbout(p) {
  const since = p.stats && p.stats.sinceYear ? ` since ${p.stats.sinceYear}` : "";
  return `${p.name || "We're"} a neighborhood auto shop${since ? "," : ""}${since}. We keep it simple: quick service, fair prices posted up front, and a straight answer about what your car needs and what can wait.`;
}

function jsonLd(p, fullAddress) {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const hours = (p.hoursWeek || []).map((d, i) => (d.closed ? null : { "@type": "OpeningHoursSpecification", dayOfWeek: days[i], opens: d.open, closes: d.close })).filter(Boolean);
  const [city, rest] = (p.cityLine || "").split(",").map((s) => (s || "").trim());
  const [region, zip] = (rest || "").split(/\s+/);
  return {
    "@context": "https://schema.org",
    "@type": "AutoRepair",
    name: p.name,
    telephone: p.phone || undefined,
    email: p.email || undefined,
    address: fullAddress ? { "@type": "PostalAddress", streetAddress: p.address, addressLocality: city || undefined, addressRegion: region || undefined, postalCode: zip || undefined, addressCountry: "US" } : undefined,
    openingHoursSpecification: hours.length ? hours : undefined,
    sameAs: Object.values(p.links || {}).map(safeUrl).filter(Boolean),
  };
}

export function renderSite(p, opts = {}) {
  const brand = p.brandColor || "#8e2f2f";
  const accent = p.accentColor || "#1e8fd0";
  const fullAddress = [p.address, p.cityLine].filter(Boolean).join(", ");
  const mapQ = encodeURIComponent([p.name, fullAddress].filter(Boolean).join(", "));
  const tagline = p.tagline || defaultTagline(p);
  const about = p.about || defaultAbout(p);
  const logo = safeImg(p.logo);
  /* an uploaded logo is a data URL; print it once, not three times */
  const logoUrl = logo && !logo.startsWith("data:") ? logo : "";
  const hero = safeImg(p.heroPhoto);
  const title = [p.name, (p.cityLine || "").split(",")[0].trim()].filter(Boolean).join(" · ");
  const desc = `${tagline} ${p.phone ? "Call " + p.phone + "." : ""}`.trim();
  const hasQuote = (p.vehicles || []).length > 0 && (p.oilPackages || []).length > 0;
  const hasPrices = (p.oilPackages || []).length > 0 || (p.prices || []).length > 0;
  const links = Object.entries(p.links || {})
    .map(([k, u]) => [k, safeUrl(u)])
    .filter(([, u]) => u);
  const linkLabel = { google: "Google", yelp: "Yelp", facebook: "Facebook", instagram: "Instagram" };

  const nav = [
    ["services", "Services"],
    hasPrices && ["prices", "Prices"],
    (p.deals || []).length && ["specials", "Specials"],
    p.booking && ["book", "Book"],
    ["visit", "Visit"],
  ].filter(Boolean);

  const stats = p.stats && (p.stats.sinceYear || p.stats.services >= 100)
    ? `<div class="stats">
        ${p.stats.sinceYear ? `<div><b>${esc(p.stats.sinceYear)}</b><span>serving drivers since</span></div>` : ""}
        ${p.stats.services >= 100 ? `<div><b>${esc(p.stats.services.toLocaleString("en-US"))}${p.stats.plus ? "+" : ""}</b><span>services done</span></div>` : ""}
        ${(p.oilPackages || []).length ? `<div><b>${esc(money(Math.min(...p.oilPackages.map((x) => x.price))))}</b><span>oil changes from</span></div>` : ""}
      </div>`
    : "";

  const services = (p.services || [])
    .map(
      (s) => `<article class="svc">
        <h3>${esc(s.name)}</h3>
        ${s.blurb ? `<p>${esc(s.blurb)}</p>` : ""}
        <div class="svcFoot">${s.from != null ? `<span class="from">from <b>${esc(money(s.from))}</b></span>` : "<span></span>"}${
          p.booking ? `<a href="#book" data-svc="${esc(s.name)}" class="ask">Request →</a>` : ""
        }</div>
      </article>`
    )
    .join("");

  const oilRows = (p.oilPackages || [])
    .map(
      (k) => `<tr><td><b>${esc(k.name)}</b>${k.details ? `<small>${esc(k.details)}</small>` : ""}</td><td class="num">${esc(money(k.price))}${
        k.extraQuart ? `<small>+${esc(money(k.extraQuart))}/qt over ${esc(k.quarts)}</small>` : ""
      }</td></tr>`
    )
    .join("");
  const jobRows = (p.prices || []).map((j) => `<tr><td><b>${esc(j.name)}</b>${j.category ? `<small>${esc(j.category)}</small>` : ""}</td><td class="num">${esc(money(j.price))}</td></tr>`).join("");

  const deals = (p.deals || [])
    .map(
      (d) => `<article class="deal" data-ends="${esc(d.endsAt)}">
        <div class="off">${esc(d.off)}</div>
        <h3>${esc(d.title)}</h3>
        ${d.services && d.services.length ? `<p>On ${esc(d.services.slice(0, 3).join(", "))}${d.services.length > 3 ? " and more" : ""}.</p>` : "<p>On any service.</p>"}
        <p class="fine">${[d.code ? `Mention code <b>${esc(d.code)}</b>.` : "", d.firstTimeOnly ? "First visit only." : "", d.endsAt ? `Ends ${esc(d.endsAt)}.` : "", "One per visit."].filter(Boolean).join(" ")}</p>
      </article>`
    )
    .join("");

  const hours = hoursRows(p.hoursWeek)
    .map((r) => `<tr><td>${esc(r.days)}</td><td class="num">${esc(r.text)}</td></tr>`)
    .join("");

  const faq = (p.faq || []).map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("");
  const svcOptions = (p.services || []).map((s) => `<option>${esc(s.name)}</option>`).join("");

  /* the page's data for the little script at the bottom */
  const pageData = {
    hours: p.hoursWeek,
    tz: p.timeZone || "America/Los_Angeles",
    days: DAY_NAMES,
    pkgs: (p.oilPackages || []).map((k) => [k.name, k.price, k.quarts, k.extraQuart, k.kind || ""]),
    cars: hasQuote ? p.vehicles : [],
    api: opts.api && opts.api.url && opts.api.key && opts.api.shopId ? opts.api : null,
    preview: !!opts.preview,
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title || "Auto service")}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
${hero && !hero.startsWith("data:") ? `<meta property="og:image" content="${esc(hero)}">` : ""}
<meta name="theme-color" content="${esc(brand)}">
${logoUrl ? `<link rel="icon" href="${esc(logoUrl)}">` : ""}
<script type="application/ld+json">${jsonForScript(jsonLd(p, fullAddress))}</script>
<style>
:root{--brand:${brand};--accent:${accent};--ink:#1b1d21;--ink2:#555b66;--line:#e4e2dd;--paper:#fbfaf7;--card:#fff;--ok:#1f8a4c}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:72px}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--accent)}
.wrap{max-width:1120px;margin:0 auto;padding:0 20px}
.num{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
header.top{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.94);backdrop-filter:saturate(1.4) blur(8px);border-bottom:1px solid var(--line)}
header.top .wrap{display:flex;align-items:center;gap:18px;height:64px}
.brandmark{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--ink);font-weight:800;font-size:18px;min-width:0}
.brandmark img{height:44px;width:auto;max-width:160px;object-fit:contain}
header nav{display:flex;gap:4px;margin-left:auto}
header nav a{color:var(--ink2);text-decoration:none;font-weight:600;font-size:15px;padding:8px 10px;border-radius:8px}
header nav a:hover{background:#f1efe9;color:var(--ink)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 22px;border-radius:12px;font-weight:700;font-size:16px;text-decoration:none;border:2px solid transparent;cursor:pointer;font-family:inherit}
.btn.primary{background:var(--brand);color:#fff}
.btn.primary:hover{filter:brightness(1.08)}
.btn.ghost{background:#fff;color:var(--ink);border-color:var(--line)}
.btn.ghost:hover{border-color:var(--ink2)}
.callTop{min-height:40px;padding:0 16px;font-size:15px}
.hero{position:relative;overflow:hidden;color:#fff;background:linear-gradient(135deg,var(--brand),color-mix(in srgb,var(--brand) 55%,#000))}
.hero.photo{background:#111}
.hero .bg{position:absolute;inset:0;background-size:cover;background-position:center;opacity:.45}
.hero .wrap{position:relative;padding:72px 20px 64px;display:grid;grid-template-columns:1.25fr .9fr;gap:40px;align-items:center}
.hero h1{font-size:clamp(34px,5vw,56px);line-height:1.05;margin:14px 0 16px;letter-spacing:-.02em;text-wrap:balance}
.hero p.lead{font-size:19px;opacity:.92;margin:0 0 26px;max-width:36em}
.hero .ctas{display:flex;flex-wrap:wrap;gap:12px}
.hero .btn.primary{background:#fff;color:var(--brand)}
.hero .btn.ghost{background:transparent;color:#fff;border-color:rgba(255,255,255,.55)}
.status{display:inline-flex;align-items:center;gap:8px;background:rgba(0,0,0,.28);border-radius:99px;padding:6px 14px;font-weight:600;font-size:14px}
.status i{width:9px;height:9px;border-radius:50%;background:#bbb}
.status.open i{background:#4ade80;box-shadow:0 0 0 4px rgba(74,222,128,.25)}
.heroCard{background:#fff;color:var(--ink);border-radius:18px;padding:22px;box-shadow:0 20px 50px rgba(0,0,0,.25)}
.heroCard img{display:block;max-width:100%;max-height:150px;margin:0 auto 12px;object-fit:contain}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:10px;text-align:center}
.stats div{background:#f6f4ef;border-radius:12px;padding:12px 6px}
.stats b{display:block;font-size:24px;color:var(--brand);font-variant-numeric:tabular-nums}
.stats span{font-size:12px;color:var(--ink2);text-transform:uppercase;letter-spacing:.04em}
.strip{background:#fff;border-bottom:1px solid var(--line)}
.strip ul{list-style:none;margin:0 auto;padding:18px 20px;max-width:1120px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px 24px}
.strip li{display:flex;gap:10px;align-items:flex-start;font-weight:600;color:var(--ink2)}
.strip li:before{content:"✓";color:var(--ok);font-weight:900}
section{padding:72px 0}
section h2{font-size:clamp(28px,3.4vw,38px);margin:0 0 8px;letter-spacing:-.01em}
section .sub{color:var(--ink2);margin:0 0 30px;font-size:17px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px}
.svc{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;display:flex;flex-direction:column}
.svc h3{margin:0 0 6px;font-size:19px}
.svc p{margin:0 0 16px;color:var(--ink2);font-size:15px;flex:1}
.svcFoot{display:flex;justify-content:space-between;align-items:center}
.from{color:var(--ink2);font-size:14px}.from b{color:var(--ink);font-size:18px;font-variant-numeric:tabular-nums}
.ask{font-weight:700;text-decoration:none}
.alt{background:#fff;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.quote{display:grid;grid-template-columns:1fr 1.1fr;gap:28px;align-items:start}
.pick{display:grid;gap:10px}
.pick label{font-weight:700;font-size:14px;color:var(--ink2)}
select,input,textarea{width:100%;min-height:48px;padding:10px 12px;border:1.5px solid var(--line);border-radius:10px;font:inherit;background:#fff;color:var(--ink)}
select:focus,input:focus,textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
select:disabled{background:#f4f3ef;color:#999}
.result{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:20px;min-height:220px}
.result .spec{font-size:15px;color:var(--ink2);margin:0 0 12px}
.result .spec b{color:var(--ink)}
.opt{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid var(--line)}
.opt:first-of-type{border-top:0}
.opt b{font-size:20px;font-variant-numeric:tabular-nums}
.empty{color:var(--ink2);display:grid;place-items:center;text-align:center;min-height:180px}
table.prices{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden}
table.prices td{padding:14px 16px;border-top:1px solid var(--line);vertical-align:top}
table.prices tr:first-child td{border-top:0}
table.prices small{display:block;color:var(--ink2);font-weight:400;font-size:13px;margin-top:2px}
.twoCol{display:grid;grid-template-columns:1fr 1fr;gap:24px}
.twoCol h3{margin:0 0 12px}
.deal{background:#fff;border:2px dashed color-mix(in srgb,var(--brand) 55%,#fff);border-radius:16px;padding:20px}
.deal .off{display:inline-block;background:var(--brand);color:#fff;font-weight:800;border-radius:8px;padding:4px 10px;margin-bottom:8px}
.deal h3{margin:0 0 6px}
.deal p{margin:0 0 6px;color:var(--ink2)}
.deal .fine{font-size:13px}
.about{display:grid;grid-template-columns:1.1fr .9fr;gap:36px;align-items:start}
.about p{font-size:18px;color:var(--ink2);margin:0 0 18px}
details{background:#fff;border:1px solid var(--line);border-radius:12px;padding:0 18px;margin-bottom:10px}
summary{cursor:pointer;font-weight:700;padding:16px 0;list-style:none}
summary::-webkit-details-marker{display:none}
summary:after{content:"+";float:right;color:var(--ink2);font-weight:400}
details[open] summary:after{content:"–"}
details p{margin:0 0 16px;color:var(--ink2)}
form.book{display:grid;grid-template-columns:1fr 1fr;gap:14px;background:#fff;border:1px solid var(--line);border-radius:18px;padding:24px}
form.book .full{grid-column:1/-1}
form.book label{display:grid;gap:6px;font-weight:700;font-size:14px;color:var(--ink2)}
form.book .hp{position:absolute;left:-9999px}
.formMsg{grid-column:1/-1;margin:0;font-weight:600}
.formMsg.err{color:#b42318}.formMsg.ok{color:var(--ok)}
.visit{display:grid;grid-template-columns:1fr 1.2fr;gap:24px}
.visit .card{background:#fff;border:1px solid var(--line);border-radius:18px;padding:24px}
.visit table{width:100%;border-collapse:collapse}
.visit td{padding:8px 0;border-top:1px solid var(--line)}
.visit tr.today td{font-weight:800;color:var(--brand)}
.map{border:0;width:100%;height:100%;min-height:360px;border-radius:18px;background:#e9e7e1}
.big{font-size:22px;font-weight:800;text-decoration:none;color:var(--ink)}
.social{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.social a{font-weight:700;font-size:14px;text-decoration:none;border:1px solid var(--line);border-radius:99px;padding:6px 14px;color:var(--ink)}
.portal{background:var(--ink);color:#fff}
.portal .wrap{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:28px 20px;flex-wrap:wrap}
.portal p{margin:0;font-size:18px}
.portal .btn{background:#fff;color:var(--ink)}
footer{padding:28px 0 90px;color:var(--ink2);font-size:14px}
footer .wrap{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
footer a{color:var(--ink2)}
.mbar{display:none}
@media (max-width:860px){
  header nav{display:none}
  .callTop{margin-left:auto}
  .hero .wrap,.quote,.twoCol,.about,.visit{grid-template-columns:1fr}
  .hero .wrap{padding:44px 20px}
  section{padding:52px 0}
  form.book{grid-template-columns:1fr}
  .mbar{display:grid;grid-template-columns:1fr 1fr;gap:10px;position:fixed;left:0;right:0;bottom:0;z-index:30;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:#fff;border-top:1px solid var(--line);box-shadow:0 -6px 20px rgba(0,0,0,.08)}
  .mbar .btn{min-height:50px}
}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
</style>
</head>
<body>
<header class="top"><div class="wrap">
  <a class="brandmark" href="#top">${logo ? `<img src="${esc(logo)}" alt="${esc(p.name)}">` : esc(p.name)}</a>
  <nav>${nav.map(([id, l]) => `<a href="#${id}">${esc(l)}</a>`).join("")}</nav>
  ${p.phone ? `<a class="btn primary callTop" href="${esc(telHref(p.phone))}">Call ${esc(p.phone)}</a>` : ""}
</div></header>

<main id="top">
<div class="hero${hero ? " photo" : ""}">
  ${hero ? `<div class="bg" style="background-image:url('${esc(hero)}')"></div>` : ""}
  <div class="wrap">
    <div>
      <span class="status" id="status"><i></i><span>${esc(p.name)}</span></span>
      <h1>${esc(tagline)}</h1>
      <p class="lead">${esc(fullAddress || "")}</p>
      <div class="ctas">
        ${p.phone ? `<a class="btn primary" href="${esc(telHref(p.phone))}">Call now</a>` : ""}
        ${p.booking ? `<a class="btn ghost" href="#book">Request a time</a>` : ""}
        ${fullAddress ? `<a class="btn ghost" href="https://www.google.com/maps/dir/?api=1&destination=${mapQ}" target="_blank" rel="noopener">Directions</a>` : ""}
      </div>
    </div>
    ${logoUrl || stats ? `<div class="heroCard">${logoUrl ? `<img src="${esc(logoUrl)}" alt="">` : ""}${stats}</div>` : ""}
  </div>
</div>

${(p.highlights || []).length ? `<div class="strip"><ul>${p.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}</ul></div>` : ""}

<section id="services"><div class="wrap">
  <h2>What we do</h2>
  <p class="sub">Drive in, or request a time and we'll have a bay ready.</p>
  <div class="grid">${services}</div>
</div></section>

${hasQuote ? `<section id="quote" class="alt"><div class="wrap">
  <h2>What does an oil change cost for my car?</h2>
  <p class="sub">Pick your car. We'll show the oil it takes and your price for each oil.</p>
  <div class="quote">
    <div class="pick">
      <label for="qy">Year</label><select id="qy"><option value="">Year</option></select>
      <label for="qm">Make</label><select id="qm" disabled><option value="">Make</option></select>
      <label for="qd">Model</label><select id="qd" disabled><option value="">Model</option></select>
      <label for="qe">Engine</label><select id="qe" disabled><option value="">Engine</option></select>
    </div>
    <div class="result" id="qr"><div class="empty">Pick your year, make and model<br>to see your price.</div></div>
  </div>
</div></section>` : ""}

${hasPrices ? `<section id="prices"><div class="wrap">
  <h2>Prices, up front</h2>
  <p class="sub">What you see is what you pay for the service. ${esc(p.taxNote || "")}</p>
  <div class="twoCol">
    ${oilRows ? `<div><h3>Oil changes</h3><table class="prices">${oilRows}</table></div>` : ""}
    ${jobRows ? `<div><h3>Fluid & maintenance services</h3><table class="prices">${jobRows}</table></div>` : ""}
  </div>
</div></section>` : ""}

${deals ? `<section id="specials" class="alt"><div class="wrap">
  <h2>Current specials</h2>
  <p class="sub">Show this page or mention the code at the counter.</p>
  <div class="grid">${deals}</div>
</div></section>` : ""}

<section id="about"><div class="wrap about">
  <div>
    <h2>About ${esc(p.name)}</h2>
    <p>${esc(about)}</p>
    ${p.ardNumber ? `<p style="font-size:15px">Registered with the California Bureau of Automotive Repair, ${esc(p.ardNumber)}.</p>` : ""}
  </div>
  <div>${faq}</div>
</div></section>

${p.booking ? `<section id="book" class="alt"><div class="wrap">
  <h2>Request a time</h2>
  <p class="sub">Tell us what you need. We'll call or text to confirm. Walk-ins are always welcome.</p>
  <form class="book" id="bookForm" novalidate>
    <label>Your name<input name="name" autocomplete="name" required maxlength="80"></label>
    <label>Phone<input name="phone" type="tel" autocomplete="tel" maxlength="20"></label>
    <label>Email (optional)<input name="email" type="email" autocomplete="email" maxlength="120"></label>
    <label>Vehicle<input name="vehicle" placeholder="2018 Honda Civic" maxlength="80"></label>
    <label>Service<select name="service"><option value="">Choose one</option>${svcOptions}<option>Something else</option></select></label>
    <label>Preferred day<input name="day" type="date"></label>
    <label class="full">Anything we should know?<textarea name="note" rows="3" maxlength="1000" placeholder="Noise when braking, check engine light, etc."></textarea></label>
    <label class="hp" aria-hidden="true">Leave blank<input name="website" tabindex="-1" autocomplete="off"></label>
    <p class="formMsg" id="formMsg" role="status"></p>
    <div class="full"><button class="btn primary" type="submit">Send request</button></div>
  </form>
</div></section>` : ""}

<section id="visit"><div class="wrap">
  <h2>Visit us</h2>
  <p class="sub">${esc(fullAddress)}</p>
  <div class="visit">
    <div class="card">
      ${p.phone ? `<a class="big" href="${esc(telHref(p.phone))}">${esc(p.phone)}</a><br>` : ""}
      ${p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ""}
      <h3 style="margin:20px 0 6px">Hours</h3>
      <table id="hours">${hours}</table>
      ${fullAddress ? `<p><a class="btn ghost" style="margin-top:16px" href="https://www.google.com/maps/dir/?api=1&destination=${mapQ}" target="_blank" rel="noopener">Get directions</a></p>` : ""}
      ${links.length ? `<div class="social">${links.map(([k, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(linkLabel[k] || k)}</a>`).join("")}</div>` : ""}
    </div>
    ${fullAddress ? `<iframe class="map" title="Map" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=${mapQ}&output=embed"></iframe>` : ""}
  </div>
</div></section>

${opts.portalUrl ? `<div class="portal"><div class="wrap"><p><b>Already a customer?</b> See your cars, what's due, and every receipt.</p><a class="btn" href="${esc(opts.portalUrl)}">My Garage →</a></div></div>` : ""}
</main>

<footer><div class="wrap">
  <span>© ${new Date().getFullYear()} ${esc(p.name)}${p.ardNumber ? ` · BAR ${esc(p.ardNumber)}` : ""}</span>
  <span>Website by <a href="https://odaymia.github.io/shop-desk/" target="_blank" rel="noopener">Bolt Badger</a></span>
</div></footer>

<div class="mbar">
  ${p.phone ? `<a class="btn primary" href="${esc(telHref(p.phone))}">Call</a>` : ""}
  ${p.booking ? `<a class="btn ghost" href="#book">Request a time</a>` : `<a class="btn ghost" href="#visit">Directions</a>`}
</div>

<script>window.SITE=${jsonForScript(pageData)};</script>
<script>${CLIENT_JS}</script>
</body>
</html>`;
}

/* The page's own script: open-now badge, today's hours, the oil change
   quote, and the booking form. Self-contained so the downloaded page works
   anywhere. Kept in step with openStatus, packagePrice and packagesFor in website.js. */
const CLIENT_JS = `(function(){
var S=window.SITE,$=function(id){return document.getElementById(id)};
function clock(t){var a=t.split(":"),h=+a[0],m=+a[1];return (h%12||12)+(m?":"+(m<10?"0":"")+m:"")+(h>=12?"pm":"am")}
function mins(t){var a=t.split(":");return a[0]*60+ +a[1]}
function nowAt(){try{var f=new Intl.DateTimeFormat("en-US",{timeZone:S.tz,weekday:"short",hour:"numeric",minute:"numeric",hourCycle:"h23"}).formatToParts(new Date()),o={};f.forEach(function(p){o[p.type]=p.value});return{day:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(o.weekday),minutes:(+o.hour%24)*60+ +o.minute}}catch(e){var d=new Date();return{day:d.getDay(),minutes:d.getHours()*60+d.getMinutes()}}}
function status(){var n=nowAt(),w=S.hours,t=w[n.day];if(!t.closed&&n.minutes>=mins(t.open)&&n.minutes<mins(t.close))return[true,"Open now · until "+clock(t.close)];
for(var k=0;k<7;k++){var i=(n.day+k)%7,d=w[i];if(d.closed)continue;if(k===0&&n.minutes>=mins(d.open))continue;return[false,"Closed · opens "+(k===0?"today":k===1?"tomorrow":S.days[i])+" at "+clock(d.open)]}return[false,"Closed"]}
var st=$("status");if(st&&S.hours){var s=status();st.className="status"+(s[0]?" open":"");st.lastChild.textContent=s[1]}
var today=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][nowAt().day],rows=document.querySelectorAll("#hours tr");
for(var r=0;r<rows.length;r++){var dd=rows[r].cells[0].textContent.split(" – "),a=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],x=a.indexOf(dd[0]),y=a.indexOf(dd[1]||dd[0]),ti=a.indexOf(today),inR=x<=y?(ti>=x&&ti<=y):(ti>=x||ti<=y);if(inR)rows[r].className="today"}
var today10=new Date().toISOString().slice(0,10);document.querySelectorAll(".deal[data-ends]").forEach(function(el){var e=el.getAttribute("data-ends");if(e&&e<today10)el.remove()});
function money(n){return "$"+(+n).toFixed(2)}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function fill(sel,vals,label){sel.innerHTML='<option value="">'+label+'</option>'+vals.map(function(v){return'<option>'+esc(v)+'</option>'}).join("");sel.disabled=!vals.length}
function uniq(a){var o=[],s={};a.forEach(function(v){if(!s[v]){s[v]=1;o.push(v)}});return o}
var qy=$("qy"),qm=$("qm"),qd=$("qd"),qe=$("qe"),qr=$("qr"),C=S.cars||[];
if(qy&&C.length){
  fill(qy,uniq(C.map(function(c){return String(c[0])})),"Year");
  var pick=function(){return C.filter(function(c){return(!qy.value||String(c[0])===qy.value)&&(!qm.value||c[1]===qm.value)&&(!qd.value||c[2]===qd.value)})};
  var show=function(c){if(!c){qr.innerHTML='<div class="empty">Pick your year, make and model<br>to see your price.</div>';return}
    var q=c[5],h='<p class="spec">'+esc(c[0]+" "+c[1]+" "+c[2]+(c[3]?" · "+c[3]:""))+'<br>Takes <b>'+q+' quarts</b>'+(c[4]?' of <b>'+esc(c[4])+'</b>':'')+'.</p>';
    var ks=S.pkgs.map(function(k){return k[4]}),kind=c[6]||"",idx=ks.map(function(k,i){return i}).filter(function(i){return kind==="d"?ks[i]==="d":ks[i]===""||(kind==="e"&&ks[i]==="e")});if(!idx.length)idx=ks.map(function(k,i){return i});
    idx.map(function(i){return S.pkgs[i]}).forEach(function(k){var extra=Math.max(0,Math.round((Math.round(q*10)/10-k[2])*100)/100),p=Math.round((k[1]+extra*k[3])*100)/100;h+='<div class="opt"><span>'+esc(k[0])+(extra?'<br><small>includes '+extra+' extra qt</small>':'')+'</span><b>'+money(p)+'</b></div>'});
    h+='<p class="spec" style="margin-top:12px;font-size:13px">Price for the oil change service before tax. We confirm your oil at the counter.</p><a class="btn primary" href="#book" data-svc="Oil change">Request a time</a>';qr.innerHTML=h};
  qy.onchange=function(){fill(qm,qy.value?uniq(pick().map(function(c){return c[1]})).sort():[],"Make");fill(qd,[],"Model");fill(qe,[],"Engine");show(null)};
  qm.onchange=function(){fill(qd,qm.value?uniq(pick().map(function(c){return c[2]})).sort():[],"Model");fill(qe,[],"Engine");show(null)};
  qd.onchange=function(){var L=qd.value?pick():[];fill(qe,uniq(L.map(function(c){return c[3]||"Standard"})),"Engine");if(L.length===1){qe.value=L[0][3]||"Standard";show(L[0])}else show(null)};
  qe.onchange=function(){var c=pick().filter(function(c){return(c[3]||"Standard")===qe.value})[0];show(c||null)};
}
document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("[data-svc]");if(!a)return;var f=$("bookForm");if(!f)return;var sel=f.elements.service,v=a.getAttribute("data-svc");for(var i=0;i<sel.options.length;i++)if(sel.options[i].text===v)sel.value=v;
  var y=qy&&qy.value,m=qm&&qm.value,d=qd&&qd.value;if(y&&m&&d&&!f.elements.vehicle.value)f.elements.vehicle.value=y+" "+m+" "+d});
var form=$("bookForm"),msg=$("formMsg");
if(form){form.onsubmit=function(e){e.preventDefault();var f=form.elements,v=function(n){return(f[n].value||"").trim()};
  msg.className="formMsg";if(v("website"))return;
  var ph=v("phone").replace(/\\D/g,""),em=v("email");
  if(!v("name")){msg.className="formMsg err";msg.textContent="Please tell us your name.";return}
  if(ph.length<10&&!/^\\S+@\\S+\\.\\S+$/.test(em)){msg.className="formMsg err";msg.textContent="Leave a phone number or email so we can confirm.";return}
  if(S.preview||!S.api){msg.className="formMsg ok";msg.textContent=S.preview?"Preview: this is where the request is sent once the site is published.":"Thanks! Please call us to confirm.";return}
  var btn=form.querySelector("button");btn.disabled=true;
  fetch(S.api.url+"/rest/v1/site_requests",{method:"POST",headers:{apikey:S.api.key,Authorization:"Bearer "+S.api.key,"Content-Type":"application/json",Prefer:"return=minimal"},
    body:JSON.stringify({shop_id:S.api.shopId,name:v("name"),phone:v("phone"),email:em,vehicle:v("vehicle"),service:v("service"),preferred_day:v("day")||null,note:v("note")})})
  .then(function(r){if(!r.ok)throw new Error(r.status);msg.className="formMsg ok";msg.textContent="Got it! We'll call or text you to confirm your time.";form.reset()})
  .catch(function(){msg.className="formMsg err";msg.textContent="That didn't go through. Please call us instead."})
  .then(function(){btn.disabled=false})}}
})();`;
