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
import { hoursRows, DAY_NAMES, slugify } from "./website.js";
import { pageContent, photoUrl } from "./serviceContent.js";

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
  const since = p.stats && p.stats.sinceYear ? ` serving drivers since ${p.stats.sinceYear}` : "";
  return `${p.name ? p.name + " is" : "We're"} a neighborhood auto shop${since}. We keep it simple: quick service, fair prices posted up front, and a straight answer about what your car needs and what can wait.`;
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

/* Line icons (24×24, stroke) for the service cards and contact rows. */
const ICONS = {
  oil: '<path d="M12 2.8s6.2 6.8 6.2 11.6a6.2 6.2 0 0 1-12.4 0C5.8 9.6 12 2.8 12 2.8z"/><path d="M9 15a3 3 0 0 0 3 3"/>',
  brakeFluid: '<path d="M12 2.8s6.2 6.8 6.2 11.6a6.2 6.2 0 0 1-12.4 0C5.8 9.6 12 2.8 12 2.8z"/><path d="M12 11v5M9.5 13.5h5"/>',
  brakes: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 5.5v1M12 17.5v1M5.5 12h1M17.5 12h1"/><path d="M16.2 3.9a9 9 0 0 1 3.9 3.9"/>',
  tires: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v5M12 16v5M3 12h5M16 12h5"/>',
  air: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>',
  cabin: '<path d="M5 19c0-8 6-14 15-14 0 9-6 15-14 15"/><path d="M5 19l7-7"/>',
  wipers: '<path d="M3 13a9 9 0 0 1 18 0"/><path d="M12 13L5.5 6.5"/><circle cx="12" cy="13" r="1.3"/>',
  trans: '<circle cx="6" cy="5" r="1.8"/><circle cx="12" cy="5" r="1.8"/><circle cx="18" cy="5" r="1.8"/><circle cx="6" cy="19" r="1.8"/><circle cx="12" cy="19" r="1.8"/><path d="M6 7v10M12 7v10M18 7v5H6"/>',
  coolant: '<path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z"/><path d="M12 9v7"/>',
  fuel: '<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M4 10h10"/><path d="M14 8h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V8l-3-3"/>',
  steering: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M12 14v7M10.1 11.4 3.4 9.8M13.9 11.4l6.7-1.6"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  battery: '<rect x="3" y="7" width="18" height="12" rx="2"/><path d="M7 7V5M17 7V5M6.5 13h3M14.5 13h3M16 11.5v3"/>',
  ac: '<path d="M12 2v20M3.3 7l17.4 10M20.7 7 3.3 17"/><path d="M9.5 3.5 12 6l2.5-2.5M9.5 20.5 12 18l2.5 2.5"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  phone: '<path d="M5 3h3.5l1.8 4.5-2.3 1.4a11 11 0 0 0 5.1 5.1l1.4-2.3L19 13.5V17a2 2 0 0 1-2 2A15 15 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5a7 7 0 0 0-14 0C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6 8.5 7 8.5-7"/>',
  scissors: '<circle cx="6" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/><path d="M8 7.5 20 17M8 16.5 20 7"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.3 7.5 9.5 4.3-1.2 7.5-4.9 7.5-9.5V6L12 3z"/><path d="m8.8 12 2.2 2.2 4.3-4.4"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  warn: '<path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  walk: '<circle cx="13" cy="4" r="2"/><path d="m9 21 3-7 3 3v5M7 12l3-4 4 1 3 3"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2A5 5 0 0 1 21 19"/>',
};
const ICON_RULES = [
  [/brake fluid/i, "brakeFluid"],
  [/oil|lube/i, "oil"],
  [/brake/i, "brakes"],
  [/tire|wheel|align/i, "tires"],
  [/cabin/i, "cabin"],
  [/air filter|air$/i, "air"],
  [/wiper/i, "wipers"],
  [/trans|clutch/i, "trans"],
  [/radiator|coolant|cool/i, "coolant"],
  [/fuel/i, "fuel"],
  [/steer|susp/i, "steering"],
  [/diff|axle|gear/i, "gear"],
  [/batter|electric|start/i, "battery"],
  [/a\/c|air cond|heat/i, "ac"],
];
/* An icon for a selling point, from what it's about */
const HIGHLIGHT_ICONS = [
  [/brake/i, "brakes"],
  [/oil/i, "oil"],
  [/warrant|guarantee/i, "shield"],
  [/open|saturday|sunday|hours|walk-?in/i, "clock"],
  [/price|estimate|surprise|quote/i, "tag"],
  [/trust|neighbor|since|review|rated/i, "star"],
  [/people|family|answer|honest/i, "people"],
  [/tire/i, "tires"],
];
const iconForHighlight = (t) => (HIGHLIGHT_ICONS.find(([re]) => re.test(t)) || [])[1] || "check";
const icon = (name, cls = "ic") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.wrench}</svg>`;
const iconFor = (name) => icon((ICON_RULES.find(([re]) => re.test(name)) || [])[1] || "wrench");

/* "$54.99" as a big number with small cents */
const bigPrice = (n) => {
  const [d, c] = (Number(n) || 0).toFixed(2).split(".");
  return `<span class="bigPrice"><sup>$</sup>${esc(d)}${c !== "00" ? `<sup>.${esc(c)}</sup>` : ""}</span>`;
};
/* Package names often repeat the oil brand; the card headline drops the
   brand and "Oil Change" so it reads as a tier: "Full Synthetic". */
const tierName = (name) => String(name).replace(/\b(valvoline|mobil ?1?|castrol|pennzoil|quaker state)\b/i, "").replace(/\boil change\b/i, "").replace(/\s+/g, " ").trim() || name;

/* "$10 OFF ANY FLUID SERVICE" under a big "$10 OFF" reads twice; keep the rest. */
function dealLine(d) {
  const t = String(d.title || "").trim();
  const rest = t.replace(/^\$?\d+(\.\d+)?%?\s*off\b[\s:,-]*/i, "").trim();
  if (rest) return rest;
  return d.services && d.services.length ? `On ${d.services.slice(0, 3).join(", ")}${d.services.length > 3 ? " and more" : ""}` : "On any service";
}

/* One service's own page: photo header, why it matters, the signs a car
   needs it, what the shop does, and a side card with how often, prices,
   matching specials, and a way to book. */
function servicePage(p, s, i, { tel, garage }) {
  const content = pageContent(s.key, s.oil ? "oil change" : s.name);
  const photo = content.photo;
  /* a selling point about this very service (lifetime brake pads on the
     Brakes page) leads the page */
  const perkRe = { brakes: /brake/i, oil: /\boil\b/i, tires: /tire/i }[content.key];
  const perk = perkRe && (p.highlights || []).find((h) => h && typeof h === "object" && h.sub && perkRe.test(h.title));
  const names = new Set([...(s.prices || []).map((x) => x.name.toLowerCase()), ...(s.oil ? (p.oilPackages || []).map((x) => x.name.toLowerCase()) : [])]);
  const deals = (p.deals || []).filter((d) => (d.services || []).some((n) => names.has(String(n).toLowerCase()))).slice(0, 2);
  const priceRows = s.oil
    ? (p.oilPackages || []).map((k) => `<li><span>${esc(tierName(k.name))}</span><b>${esc(money(k.price))}</b></li>`).join("")
    : (s.prices || []).map((x) => `<li><span>${esc(x.name)}</span><b>${esc(money(x.price))}</b></li>`).join("");
  const others = (p.services || []).filter((o) => o !== s).map((o) => `<a href="#service-${esc(o.slug || slugify(o.name))}">${iconFor(o.oil ? "oil" : o.name)}${esc(o.name)}</a>`).join("");
  return `<section class="svcPage" id="service-${esc(s.slug || slugify(s.name) || i)}" data-title="${esc(s.name)} · ${esc(p.name)}">
  <div class="spHero" style="background-image:url('${esc(photoUrl(photo.id))}')">
    <div class="wrap">
      <a class="back" href="#services">${icon("back", "ic sm")} All services</a><br>
      <span class="eyebrow">${esc(p.name)}</span>
      <h1>${esc(s.name)}</h1>
      <p class="lead">${esc(content.headline)}</p>
      <div class="ctas">
        ${p.booking ? `<a class="btn primary" href="#book" data-svc="${esc(s.name)}">Book this service</a>` : ""}
        ${p.phone ? `<a class="btn ghost" href="${tel}">${icon("phone", "ic sm")} ${esc(p.phone)}</a>` : ""}
        ${s.from != null ? `<span class="chip" style="font-size:15px;padding:10px 16px">from ${esc(money(s.from))}</span>` : ""}
      </div>
    </div>
  </div>
  <div class="wrap spBody">
    <div>
      ${perk ? `<div class="perk">${icon("shield")}<div><b>${esc(perk.title)}</b><span>${esc(perk.sub)}</span></div></div>` : ""}
      <p class="spIntro">${esc(content.intro)}</p>
      ${
        content.does
          ? `<h2>${esc(content.does.title)}</h2>
      <div class="does">${content.does.items.map(([t, d], k) => `<div class="doesItem"><span class="doesN">${k + 1}</span><b>${esc(t)}</b><span>${esc(d)}</span></div>`).join("")}</div>
      <div class="wear">${icon("clock")}<div><b>Why it wears out</b><p>${esc(content.does.wear)}</p></div></div>`
          : ""
      }
      ${
        content.prevents
          ? `<h2>What it prevents</h2>
      <div class="prevents">${content.prevents.map(([t, d]) => `<div class="prevent">${icon("shield")}<div><b>${esc(t)}</b><span>${esc(d)}</span></div></div>`).join("")}</div>`
          : ""
      }
      <h2>Why it matters</h2>
      <div class="benefits">${content.benefits.map(([t, d]) => `<div class="benefit">${icon("check")}<b>${esc(t)}</b><span>${esc(d)}</span></div>`).join("")}</div>
      ${
        !content.preventive && content.symptoms.length
          ? `<h2>Signs your car needs it</h2>
      <ul class="signs">${content.symptoms.map((x) => `<li>${icon("warn")}${esc(x)}</li>`).join("")}</ul>
      <p class="signsNote">Notice one of these? ${p.booking ? `<a href="#book" data-svc="${esc(s.name)}">Request a time</a> or call us` : "Call us"} and we'll take a look.</p>`
          : ""
      }
      <h2>What we do</h2>
      <ol class="steps">${content.included.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
    </div>
    <aside class="spSide">
      ${s.howOften ? `<h4>${icon("clock", "ic sm")} How often</h4><p>${esc(s.howOften)}</p>` : ""}
      ${priceRows ? `<h4>${icon("tag", "ic sm")} Prices</h4><ul>${priceRows}</ul>` : ""}
      ${deals.map((d) => `<div class="spDeal"><b>${esc(d.off.toUpperCase())}</b>${esc(dealLine(d))}${d.code ? ` · code <strong>${esc(d.code)}</strong>` : ""}</div>`).join("")}
      ${p.booking ? `<a class="btn primary" href="#book" data-svc="${esc(s.name)}">Book this service</a>` : ""}
      ${p.phone ? `<a class="btn outline" href="${tel}">${icon("phone", "ic sm")} Call ${esc(p.phone)}</a>` : ""}
      ${garage ? `<a class="btn outline" href="${esc(garage)}">My Garage</a>` : ""}
    </aside>
  </div>
  <div class="wrap others">
    ${others ? `<h3>Other services</h3><div>${others}</div>` : ""}
    <p class="credit" style="margin-top:28px">Photo: ${esc(photo.by)} / <a href="https://unsplash.com" target="_blank" rel="noopener">Unsplash</a></p>
  </div>
</section>`;
}

export function renderSite(p, opts = {}) {
  const brand = p.brandColor || "#8e2f2f";
  const accent = p.accentColor || "#1e8fd0";
  const fullAddress = [p.address, p.cityLine].filter(Boolean).join(", ");
  const mapQ = encodeURIComponent([p.name, fullAddress].filter(Boolean).join(", "));
  const dirUrl = `https://www.google.com/maps/dir/?api=1&destination=${mapQ}`;
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
  const tel = esc(telHref(p.phone));
  /* returning customers' quickest way to their receipts: the portal */
  const garage = opts.portalUrl ? esc(opts.portalUrl) : "";

  const nav = [
    ["services", "Services"],
    hasPrices && ["prices", "Prices"],
    (p.deals || []).length && ["specials", "Specials"],
    p.booking && ["book", "Book"],
    ["visit", "Visit"],
  ].filter(Boolean);

  const statItems = [
    p.stats && p.stats.sinceYear && [esc(p.stats.sinceYear), "Serving drivers since"],
    p.stats && p.stats.services >= 100 && [`${esc(p.stats.services.toLocaleString("en-US"))}${p.stats.plus ? "+" : ""}`, "Services done"],
    (p.oilPackages || []).length && [esc(money(Math.min(...p.oilPackages.map((x) => x.price)))), "Oil changes from"],
  ].filter(Boolean);
  const stats = statItems.length ? `<div class="stats">${statItems.map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join("")}</div>` : "";

  const services = (p.services || [])
    .map(
      (s, i) => `<a class="svc rv" style="--d:${(i % 4) * 60}ms" href="#service-${esc(s.slug || slugify(s.name) || i)}">
        <div class="svcTop"><span class="svcIc">${iconFor(s.oil ? "oil" : s.name)}</span>${s.from != null ? `<span class="chip">from ${esc(money(s.from))}</span>` : ""}</div>
        <h3>${esc(s.name)}</h3>
        ${s.blurb ? `<p>${esc(s.blurb)}</p>` : "<p></p>"}
        <span class="ask">Learn more ${icon("arrow", "ic sm")}</span>
      </a>`
    )
    .join("");
  const servicePages = (p.services || []).map((s, i) => servicePage(p, s, i, { tel, garage: opts.portalUrl })).join("");

  const tiers = (p.oilPackages || [])
    .map(
      (k, i) => `<article class="tier rv" style="--d:${(i % 4) * 70}ms">
        <div class="tierBar"></div>
        <h3>${esc(tierName(k.name))}</h3>
        ${bigPrice(k.price)}
        <p class="tierQt">up to ${esc(k.quarts)} quarts${k.extraQuart ? ` · ${esc(money(k.extraQuart))} each extra` : ""}</p>
        ${k.details ? `<p class="tierDetails">${esc(k.details)}</p>` : ""}
        ${p.booking ? `<a href="#book" data-svc="Oil change" class="btn outline sm">Book this</a>` : ""}
      </article>`
    )
    .join("");
  const jobRows = (p.prices || []).map((j) => `<li><span>${iconFor(j.category || j.name)}<b>${esc(j.name)}</b></span><span class="num">${esc(money(j.price))}</span></li>`).join("");

  const deals = (p.deals || [])
    .map(
      (d, i) => `<article class="deal rv" style="--d:${(i % 3) * 70}ms" data-ends="${esc(d.endsAt)}">
        <span class="snip">${icon("scissors")}</span>
        <div class="off">${esc(d.off.toUpperCase())}</div>
        <h3>${esc(dealLine(d))}</h3>
        <div class="dealFoot">
          ${d.code ? `<span class="code">${esc(d.code)}</span>` : "<span></span>"}
          <span class="fine">${[d.firstTimeOnly ? "First visit only." : "", d.endsAt ? `Ends ${esc(d.endsAt)}.` : "", "One per visit."].filter(Boolean).join(" ")}</span>
        </div>
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
<meta name="theme-color" content="#121417">
${logoUrl ? `<link rel="icon" href="${esc(logoUrl)}">` : ""}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<script>document.documentElement.className="js"</script>
<script type="application/ld+json">${jsonForScript(jsonLd(p, fullAddress))}</script>
<style>
:root{--brand:${brand};--accent:${accent};--ink:#15171b;--ink2:#5b616c;--line:#e7e3dc;--paper:#f7f5f0;--card:#fff;--dark:#121417;--dark2:#1b1e23;--ok:#22a25a;
--display:"Barlow Condensed","Arial Narrow",Impact,system-ui,sans-serif;--body:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
--brandSoft:color-mix(in srgb,var(--brand) 10%,#fff);--shadow:0 1px 2px rgba(20,20,20,.04),0 8px 28px rgba(20,20,20,.07)}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:76px}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 var(--body);-webkit-font-smoothing:antialiased}
a{color:var(--accent)}
img{max-width:100%}
.wrap{max-width:1180px;margin:0 auto;padding:0 24px}
.num{font-variant-numeric:tabular-nums;white-space:nowrap}
.ic{width:24px;height:24px;flex:none}
.ic.sm{width:18px;height:18px}
h1,h2,h3,.display{font-family:var(--display);letter-spacing:.005em}
.eyebrow{display:inline-flex;align-items:center;gap:10px;font:700 13px/1 var(--body);letter-spacing:.14em;text-transform:uppercase;color:var(--brand);margin-bottom:12px}
.eyebrow:before{content:"";width:28px;height:3px;border-radius:2px;background:currentColor}
section{padding:96px 0}
section h2{font-size:clamp(38px,5vw,58px);line-height:.98;margin:0 0 14px;text-transform:uppercase;font-weight:800;text-wrap:balance}
section .sub{color:var(--ink2);margin:0 0 40px;font-size:18px;max-width:40em}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:52px;padding:0 26px;border-radius:12px;font:700 16px/1 var(--body);text-decoration:none;border:2px solid transparent;cursor:pointer;transition:transform .15s,box-shadow .15s,background .15s,border-color .15s}
.btn:hover{transform:translateY(-1px)}
.btn.primary{background:var(--brand);color:#fff;box-shadow:0 6px 18px color-mix(in srgb,var(--brand) 35%,transparent)}
.btn.primary:hover{box-shadow:0 10px 26px color-mix(in srgb,var(--brand) 45%,transparent)}
.btn.light{background:#fff;color:var(--ink)}
.btn.ghost{background:rgba(255,255,255,.06);color:#fff;border-color:rgba(255,255,255,.28)}
.btn.ghost:hover{border-color:#fff}
.btn.outline{background:transparent;color:var(--ink);border-color:var(--line)}
.btn.outline:hover{border-color:var(--brand);color:var(--brand)}
.btn.sm{min-height:44px;padding:0 18px;font-size:15px}

/* header */
header.top{position:sticky;top:0;z-index:40;background:rgba(18,20,23,.92);backdrop-filter:saturate(1.5) blur(10px);border-bottom:1px solid rgba(255,255,255,.07)}
header.top .wrap{display:flex;align-items:center;gap:22px;height:72px}
.brandmark{display:flex;align-items:center;gap:10px;text-decoration:none;color:#fff;font:800 24px/1 var(--display);text-transform:uppercase;min-width:0}
.brandmark img{height:48px;width:auto;max-width:170px;object-fit:contain;background:#fff;border-radius:10px;padding:4px 8px}
header nav{display:flex;gap:2px;margin-left:auto}
header nav a{color:rgba(255,255,255,.75);text-decoration:none;font-weight:600;font-size:15px;padding:10px 12px;border-radius:8px}
header nav a:hover{color:#fff;background:rgba(255,255,255,.07)}
.callTop{min-height:44px;padding:0 18px;font-size:15px}

/* hero */
.hero{position:relative;overflow:hidden;color:#fff;background:var(--dark);padding-bottom:40px;clip-path:polygon(0 0,100% 0,100% calc(100% - 44px),0 100%)}
.hero:before{content:"";position:absolute;inset:0;background:radial-gradient(900px 520px at 85% 20%,color-mix(in srgb,var(--brand) 70%,transparent),transparent 65%),radial-gradient(700px 500px at 5% 110%,color-mix(in srgb,var(--accent) 30%,transparent),transparent 60%)}
.hero:after{content:"";position:absolute;inset:0;opacity:.07;background:repeating-linear-gradient(-55deg,#fff 0 2px,transparent 2px 22px)}
.hero .bg{position:absolute;inset:0;background-size:cover;background-position:center}
.hero .bg:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(12,13,15,.94) 0%,rgba(12,13,15,.75) 50%,rgba(12,13,15,.35) 100%)}
.hero.photo:before,.hero.photo:after{display:none}
.hero .wrap{position:relative;z-index:1;padding:96px 24px 88px;display:grid;grid-template-columns:1.2fr .8fr;gap:56px;align-items:center}
.hero h1{font-size:clamp(46px,6.8vw,88px);line-height:.92;margin:22px 0 22px;text-transform:uppercase;font-weight:800;text-wrap:balance}
.hero .lead{display:flex;align-items:center;gap:10px;font-size:18px;color:rgba(255,255,255,.8);margin:0 0 34px}
.hero .ctas{display:flex;flex-wrap:wrap;gap:12px}
.status{display:inline-flex;align-items:center;gap:10px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);border-radius:99px;padding:8px 16px;font-weight:600;font-size:14px}
.status i{width:9px;height:9px;border-radius:50%;background:#9aa0a6}
.status.open i{background:#4ade80;box-shadow:0 0 0 0 rgba(74,222,128,.6);animation:pulse 2s infinite}
@keyframes pulse{70%{box-shadow:0 0 0 10px rgba(74,222,128,0)}100%{box-shadow:0 0 0 0 rgba(74,222,128,0)}}
.heroCard{position:relative;background:#fff;color:var(--ink);border-radius:22px;padding:26px;box-shadow:0 30px 70px rgba(0,0,0,.45);transform:rotate(1.2deg)}
.heroCard:before{content:"";position:absolute;inset:-10px;border-radius:28px;border:1px solid rgba(255,255,255,.14);transform:rotate(-2.4deg);pointer-events:none}
.heroCard img{display:block;max-height:170px;margin:4px auto 18px;object-fit:contain}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:10px;text-align:center}
.stats div{background:var(--paper);border-radius:14px;padding:14px 6px 12px}
.stats b{display:block;font:800 32px/1 var(--display);color:var(--brand);font-variant-numeric:tabular-nums}
.stats span{display:block;margin-top:6px;font-size:11px;font-weight:600;color:var(--ink2);text-transform:uppercase;letter-spacing:.06em}

/* selling points */
.strip{position:relative;z-index:2;margin-top:-72px}
.strip ul{list-style:none;margin:0 auto;padding:0 24px;max-width:1180px;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}
.strip li{display:flex;gap:16px;align-items:flex-start;background:#fff;border:1px solid var(--line);border-radius:18px;padding:22px 20px;box-shadow:0 18px 44px rgba(20,20,20,.12)}
.hlIc{flex:none;display:grid;place-items:center;width:48px;height:48px;border-radius:14px;background:var(--brand);color:#fff;box-shadow:0 8px 18px color-mix(in srgb,var(--brand) 35%,transparent)}
.hlIc .ic{width:26px;height:26px}
.strip b{display:block;font:800 22px/1.05 var(--display);text-transform:uppercase;color:var(--ink);margin:2px 0 6px}
.strip li span:not(.hlIc){display:block;font-size:14px;line-height:1.5;color:var(--ink2)}
/* services */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:18px}
.svc{position:relative;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:24px;display:flex;flex-direction:column;box-shadow:var(--shadow);transition:transform .2s,border-color .2s,box-shadow .2s}
.svc:hover{transform:translateY(-4px);border-color:color-mix(in srgb,var(--brand) 40%,var(--line));box-shadow:0 18px 40px rgba(20,20,20,.1)}
.svcTop{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px}
.svcIc{display:grid;place-items:center;width:54px;height:54px;border-radius:14px;background:var(--brandSoft);color:var(--brand)}
.svcIc .ic{width:28px;height:28px}
.chip{background:var(--dark);color:#fff;border-radius:99px;padding:6px 12px;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums}
.svc h3{margin:0 0 6px;font-size:26px;text-transform:uppercase;font-weight:700;line-height:1.05}
.svc p{margin:0 0 18px;color:var(--ink2);font-size:15px;flex:1}
a.svc{text-decoration:none;color:inherit;cursor:pointer}
.ask{display:inline-flex;align-items:center;gap:6px;font-weight:700;text-decoration:none;color:var(--brand)}
.svc:hover .ask .ic{transform:translateX(4px)}.ask .ic{transition:transform .15s}

/* one page per service, shown in place of the home page when its link is
   followed (#service-…). Plain CSS, so the downloaded file works too. */
section.svcPage{display:none;padding:0}
section.svcPage:target{display:block}
body:has(.svcPage:target) main{display:none}
.spHero{position:relative;color:#fff;background:var(--dark) center/cover no-repeat;min-height:460px;display:flex;align-items:flex-end;clip-path:polygon(0 0,100% 0,100% calc(100% - 36px),0 100%)}
.spHero:before{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(12,13,15,.92) 0%,rgba(12,13,15,.72) 50%,rgba(12,13,15,.2) 100%),linear-gradient(0deg,rgba(12,13,15,.6),transparent 50%)}
.spHero .wrap{position:relative;width:100%;padding-top:48px;padding-bottom:84px}
.back{display:inline-flex;align-items:center;gap:8px;color:rgba(255,255,255,.8);text-decoration:none;font-weight:600;font-size:15px;margin-bottom:26px}
.back:hover{color:#fff}
.spHero .eyebrow{color:color-mix(in srgb,var(--brand) 40%,#fff)}
.spHero h1{font-size:clamp(46px,7vw,90px);line-height:.92;margin:0 0 14px;text-transform:uppercase;font-weight:800}
.spHero .lead{font-size:clamp(19px,2.2vw,24px);color:rgba(255,255,255,.88);margin:0 0 28px;max-width:30em}
.spHero .ctas{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.spBody{display:grid;grid-template-columns:1fr 360px;gap:48px;align-items:start;padding-top:56px;padding-bottom:40px}
.perk{display:flex;gap:16px;align-items:center;background:linear-gradient(90deg,var(--brand),color-mix(in srgb,var(--brand) 70%,#000));color:#fff;border-radius:18px;padding:20px 22px;margin:0 0 32px;box-shadow:0 14px 34px color-mix(in srgb,var(--brand) 35%,transparent)}
.perk .ic{width:44px;height:44px;flex:none}
.perk b{display:block;font:800 26px/1 var(--display);text-transform:uppercase;margin-bottom:4px}
.perk span{opacity:.9}
.spIntro{font-size:21px;line-height:1.65;margin:0 0 44px;color:var(--ink)}
.spBody h2{font-size:clamp(30px,3.6vw,42px);text-transform:uppercase;margin:0 0 20px;line-height:1}
.benefits{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:52px}
.benefit{background:#fff;border:1px solid var(--line);border-radius:16px;padding:20px;box-shadow:var(--shadow)}
.benefit .ic{width:34px;height:34px;padding:7px;border-radius:10px;background:var(--ok);color:#fff;stroke-width:2.6;margin-bottom:12px}
.benefit b{display:block;font:700 22px/1.1 var(--display);text-transform:uppercase;margin-bottom:6px}
.benefit span{color:var(--ink2);font-size:15px}
.does{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px}
.doesItem{position:relative;background:#fff;border:1px solid var(--line);border-radius:16px;padding:20px 20px 20px 70px;box-shadow:var(--shadow)}
.doesN{position:absolute;left:18px;top:18px;display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:var(--brandSoft);color:var(--brand);font:800 20px/1 var(--display)}
.doesItem b{display:block;font:700 21px/1.1 var(--display);text-transform:uppercase;margin-bottom:6px}
.doesItem span:last-child{color:var(--ink2);font-size:15px}
.wear{display:flex;gap:16px;align-items:flex-start;background:var(--dark);color:#fff;border-radius:16px;padding:22px 24px;margin:0 0 52px}
.wear .ic{width:30px;height:30px;flex:none;color:color-mix(in srgb,var(--brand) 40%,#fff);margin-top:2px}
.wear b{font:800 22px/1 var(--display);text-transform:uppercase}
.wear p{margin:8px 0 0;color:rgba(255,255,255,.82)}
.prevents{display:grid;gap:10px;margin-bottom:52px}
.prevent{display:flex;gap:16px;align-items:flex-start;background:#fff;border:1px solid var(--line);border-left:4px solid var(--ok);border-radius:14px;padding:16px 18px}
.prevent .ic{width:28px;height:28px;flex:none;color:var(--ok)}
.prevent b{display:block;font:700 20px/1.1 var(--display);text-transform:uppercase;margin-bottom:4px}
.prevent span{color:var(--ink2);font-size:15px}
.signs{list-style:none;margin:0 0 16px;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:10px}
.signs li{display:flex;gap:12px;align-items:center;background:#fff;border:1px solid var(--line);border-left:4px solid #e0a100;border-radius:12px;padding:14px 16px;font-weight:600}
.signs .ic{color:#c98a00;flex:none}
.signsNote{color:var(--ink2);margin:0 0 52px}
.steps{list-style:none;counter-reset:step;margin:0 0 20px;padding:0;display:grid;gap:10px}
.steps li{counter-increment:step;display:flex;gap:16px;align-items:center;background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 18px;font-weight:600}
.steps li:before{content:counter(step);flex:none;display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:var(--dark);color:#fff;font:800 18px/1 var(--display)}
.spSide{position:sticky;top:96px;background:#fff;border:1px solid var(--line);border-radius:20px;padding:24px;box-shadow:0 20px 50px rgba(20,20,20,.1)}
.spSide h4{font:700 20px/1 var(--display);text-transform:uppercase;margin:0 0 10px;display:flex;align-items:center;gap:8px}
.spSide h4 .ic{color:var(--brand)}
.spSide p{margin:0 0 20px;color:var(--ink2);font-size:15px}
.spSide ul{list-style:none;margin:0 0 20px;padding:0}
.spSide li{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid var(--line);font-size:15px}
.spSide li b{font:700 20px/1 var(--display);white-space:nowrap}
.spDeal{background:var(--brandSoft);border:1.5px dashed color-mix(in srgb,var(--brand) 50%,#fff);border-radius:12px;padding:12px 14px;margin:0 0 10px;font-size:14px}
.spDeal b{color:var(--brand);font:800 22px/1 var(--display);display:block;margin-bottom:4px}
.spSide .btn{width:100%;margin-top:8px}
.others{padding-top:24px;padding-bottom:72px}
.others h3{font-size:28px;text-transform:uppercase;margin:0 0 14px}
.others div{display:flex;flex-wrap:wrap;gap:10px}
.others a{display:inline-flex;align-items:center;gap:8px;background:#fff;border:1px solid var(--line);border-radius:99px;padding:10px 16px;font-weight:600;color:var(--ink);text-decoration:none}
.others a:hover{border-color:var(--brand);color:var(--brand)}
.others a .ic{width:20px;height:20px;color:var(--brand)}
.credit{font-size:12px;color:var(--ink2);margin:0}
.credit a{color:var(--ink2)}

/* quote */
.dark{background:var(--dark);color:#fff;position:relative;overflow:hidden}
.dark:before{content:"";position:absolute;inset:0;background:radial-gradient(700px 400px at 100% 0%,color-mix(in srgb,var(--brand) 45%,transparent),transparent 70%)}
.dark .wrap{position:relative}
.dark .sub{color:rgba(255,255,255,.72)}
.dark .eyebrow{color:color-mix(in srgb,var(--brand) 45%,#fff)}
.quote{display:grid;grid-template-columns:.9fr 1.1fr;gap:32px;align-items:start}
.pick{display:grid;grid-template-columns:1fr 1fr;gap:14px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:24px}
.pick label{display:grid;gap:8px;font-weight:600;font-size:13px;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.06em}
select,input,textarea{width:100%;min-height:52px;padding:12px 14px;border:1.5px solid var(--line);border-radius:12px;font:inherit;font-size:16px;background:#fff;color:var(--ink);text-transform:none;letter-spacing:0}
.dark select{background:var(--dark2);color:#fff;border-color:rgba(255,255,255,.16)}
.dark select:disabled{opacity:.45}
select:focus,input:focus,textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 22%,transparent)}
.result{background:#fff;color:var(--ink);border-radius:20px;padding:26px;min-height:300px;box-shadow:0 24px 60px rgba(0,0,0,.35)}
.result .spec{font-size:15px;color:var(--ink2);margin:0 0 14px}
.result .spec b{color:var(--ink)}
.result .car{font:800 30px/1.05 var(--display);text-transform:uppercase;color:var(--ink);margin:0 0 6px}
.opt{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 16px;border:1px solid var(--line);border-radius:12px;margin-bottom:8px}
.opt small{color:var(--ink2)}
.opt b{font:800 26px/1 var(--display);font-variant-numeric:tabular-nums}
.empty{color:var(--ink2);display:grid;place-items:center;text-align:center;min-height:250px;gap:12px}
.empty .ic{width:56px;height:56px;color:var(--brand);opacity:.8}

/* prices */
.tiers{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:18px;margin-bottom:28px}
.tier{position:relative;overflow:hidden;background:#fff;border:1px solid var(--line);border-radius:20px;padding:28px 24px 24px;box-shadow:var(--shadow);display:flex;flex-direction:column}
.tierBar{position:absolute;left:0;right:0;top:0;height:6px;background:linear-gradient(90deg,var(--brand),var(--accent))}
.tier h3{margin:0 0 10px;font-size:24px;text-transform:uppercase;font-weight:700;line-height:1.05;min-height:2.1em}
.bigPrice{font:800 64px/1 var(--display);color:var(--ink);font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.bigPrice sup{font-size:.42em;vertical-align:.95em;margin:0 1px}
.tierQt{margin:10px 0 8px;font-weight:600;font-size:14px;color:var(--brand)}
.tierDetails{margin:0 0 18px;font-size:14px;color:var(--ink2);flex:1}
.list{list-style:none;margin:0;padding:6px 22px;background:#fff;border:1px solid var(--line);border-radius:20px;box-shadow:var(--shadow);columns:2 340px;column-gap:40px}
.list li{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:14px 0;border-bottom:1px solid var(--line);break-inside:avoid}
.list li span:first-child{display:flex;align-items:center;gap:12px}
.list li .ic{color:var(--brand)}
.list .num{font:700 22px/1 var(--display)}
.listHead{font-size:28px;text-transform:uppercase;margin:0 0 14px}

/* specials */
.deals{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:22px}
.deal{position:relative;background:#fff;border:2px dashed color-mix(in srgb,var(--brand) 55%,#fff);border-radius:20px;padding:30px 24px 22px;display:flex;flex-direction:column}
.snip{position:absolute;top:-14px;left:24px;background:var(--paper);padding:0 6px;color:var(--brand)}
.alt .snip{background:#fff}
.off{font:800 54px/.95 var(--display);color:var(--brand);letter-spacing:-.01em}
.deal h3{margin:8px 0 18px;font:700 22px/1.1 var(--display);color:var(--ink);text-transform:uppercase;flex:1}
.dealFoot{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.code{font:700 16px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;background:var(--dark);color:#fff;border-radius:8px;padding:9px 12px}
.fine{font-size:12px;color:var(--ink2)}

/* about */
.about{display:grid;grid-template-columns:1.05fr .95fr;gap:56px;align-items:start}
.about .big{font-size:21px;line-height:1.6;color:var(--ink);margin:0 0 24px}
.badge{display:flex;gap:14px;align-items:center;background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px 18px;box-shadow:var(--shadow);max-width:460px}
.badge .ic{width:40px;height:40px;color:var(--ok)}
.badge b{display:block}
.badge span{font-size:14px;color:var(--ink2)}
details{background:#fff;border:1px solid var(--line);border-radius:14px;padding:0 20px;margin-bottom:10px;transition:border-color .2s}
details[open]{border-color:color-mix(in srgb,var(--brand) 40%,var(--line))}
summary{cursor:pointer;font-weight:700;padding:18px 0;list-style:none;display:flex;justify-content:space-between;gap:16px}
summary::-webkit-details-marker{display:none}
summary:after{content:"+";font:700 24px/1 var(--body);color:var(--brand);transition:transform .2s}
details[open] summary:after{transform:rotate(45deg)}
details p{margin:0 0 18px;color:var(--ink2)}

/* book */
.alt{background:#fff;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.bookGrid{display:grid;grid-template-columns:.8fr 1.2fr;gap:0;border-radius:24px;overflow:hidden;box-shadow:0 30px 70px rgba(20,20,20,.14);border:1px solid var(--line)}
.bookSide{background:var(--dark);color:#fff;padding:40px 34px;position:relative;overflow:hidden}
.bookSide:before{content:"";position:absolute;inset:0;background:radial-gradient(420px 300px at 0% 100%,color-mix(in srgb,var(--brand) 60%,transparent),transparent 70%)}
.bookSide>*{position:relative}
.bookSide h3{font-size:34px;text-transform:uppercase;margin:0 0 10px;line-height:1}
.bookSide p{color:rgba(255,255,255,.75);margin:0 0 24px}
.bookSide .row{display:flex;gap:12px;align-items:center;margin:14px 0;color:#fff;text-decoration:none;font-weight:600}
.bookSide .row .ic{width:40px;height:40px;padding:9px;border-radius:12px;background:rgba(255,255,255,.1)}
form.book{display:grid;grid-template-columns:1fr 1fr;gap:16px;background:#fff;padding:36px}
form.book .full{grid-column:1/-1}
form.book label{display:grid;gap:7px;font-weight:600;font-size:14px;color:var(--ink2)}
form.book .hp{position:absolute;left:-9999px}
.formMsg{grid-column:1/-1;margin:0;font-weight:600}
.formMsg:empty{display:none}
.formMsg.err{color:#b42318}.formMsg.ok{color:var(--ok)}

/* visit */
.visit{position:relative;border-radius:24px;overflow:hidden;min-height:520px;background:#e9e7e1;box-shadow:var(--shadow)}
.map{position:absolute;inset:0;border:0;width:100%;height:100%}
.visitCard{position:relative;z-index:1;margin:28px;width:min(400px,calc(100% - 56px));background:#fff;border-radius:20px;padding:28px;box-shadow:0 24px 60px rgba(20,20,20,.22)}
.visitCard .row{display:flex;gap:12px;align-items:center;margin:0 0 12px;color:var(--ink);text-decoration:none;font-weight:600}
.visitCard .row .ic{color:var(--brand)}
.visitCard .tel{font:800 30px/1 var(--display)}
.visitCard table{width:100%;border-collapse:collapse;margin:8px 0 18px}
.visitCard td{padding:9px 0;border-top:1px solid var(--line);font-size:15px}
.visitCard td.num{text-align:right}
.visitCard tr.today td{font-weight:800;color:var(--brand)}
.social{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.social a{font-weight:700;font-size:14px;text-decoration:none;border:1px solid var(--line);border-radius:99px;padding:7px 14px;color:var(--ink)}
.social a:hover{border-color:var(--brand);color:var(--brand)}

/* portal + footer */
.portal{background:linear-gradient(90deg,var(--brand),color-mix(in srgb,var(--brand) 70%,#000));color:#fff}
.portal .wrap{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:34px 24px;flex-wrap:wrap}
.portal p{margin:0;font-size:19px}
.portal b{font:800 26px/1 var(--display);text-transform:uppercase;display:block;margin-bottom:4px}
footer{background:var(--dark);color:rgba(255,255,255,.65);padding:56px 0 110px;font-size:15px}
footer .cols{display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:32px}
footer h4{color:#fff;font:700 20px/1 var(--display);text-transform:uppercase;letter-spacing:.04em;margin:0 0 14px}
footer a{color:rgba(255,255,255,.85);text-decoration:none}
footer a:hover{color:#fff}
footer .name{font:800 34px/1 var(--display);color:#fff;text-transform:uppercase;margin:0 0 10px}
footer .legal{border-top:1px solid rgba(255,255,255,.1);margin-top:40px;padding-top:22px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font-size:13px}
.mbar{display:none}

/* reveal on scroll (only when the script runs, so nothing hides without it) */
.js .rv{opacity:0;transform:translateY(22px);transition:opacity .6s ease var(--d,0ms),transform .6s ease var(--d,0ms)}
.js .rv.in{opacity:1;transform:none}

@media (max-width:900px){
  header nav{display:none}
  .callTop{margin-left:auto}
  .hero .wrap,.quote,.about,.bookGrid{grid-template-columns:1fr}
  .hero .wrap{padding:56px 20px 64px;gap:36px}
  .strip{margin-top:-36px}
  .spBody{grid-template-columns:1fr;padding-top:36px;gap:32px}
  .spSide{position:static}
  .benefits,.signs,.does{grid-template-columns:1fr}
  .spHero{min-height:420px}
  .strip ul{padding:0 20px;gap:12px}
  .heroCard{transform:none}
  .heroCard:before{display:none}
  section{padding:64px 0}
  .wrap{padding:0 20px}
  .pick{grid-template-columns:1fr}
  form.book{grid-template-columns:1fr;padding:24px}
  .bookSide{padding:30px 24px}
  .visit{min-height:0;display:flex;flex-direction:column-reverse}
  .map{position:relative;height:300px}
  .visitCard{margin:0;width:100%;border-radius:0;box-shadow:none}
  footer .cols{grid-template-columns:1fr}
  .mbar{display:grid;grid-template-columns:1fr 1fr;gap:10px;position:fixed;left:0;right:0;bottom:0;z-index:50;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:rgba(18,20,23,.96);backdrop-filter:blur(8px)}
  .mbar .btn{min-height:52px}
}
@media (max-width:520px){.brandmark img{height:40px}.callTop{display:none}}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}.js .rv{opacity:1;transform:none;transition:none}.status.open i{animation:none}}
</style>
</head>
<body>
<header class="top"><div class="wrap">
  <a class="brandmark" href="#top">${logo ? `<img src="${esc(logo)}" alt="${esc(p.name)}">` : esc(p.name)}</a>
  <nav>${nav.map(([id, l]) => `<a href="#${id}">${esc(l)}</a>`).join("")}${garage ? `<a href="${garage}">My Garage</a>` : ""}</nav>
  ${p.phone ? `<a class="btn primary callTop" href="${tel}">${icon("phone", "ic sm")} ${esc(p.phone)}</a>` : ""}
</div></header>

<main id="top">
<div class="hero${hero ? " photo" : ""}">
  ${hero ? `<div class="bg" style="background-image:url('${esc(hero)}')"></div>` : ""}
  <div class="wrap">
    <div>
      <span class="status" id="status"><i></i><span>${esc(p.name)}</span></span>
      <h1>${esc(tagline)}</h1>
      ${fullAddress ? `<p class="lead">${icon("pin", "ic sm")} ${esc(fullAddress)}</p>` : ""}
      <div class="ctas">
        ${p.phone ? `<a class="btn primary" href="${tel}">${icon("phone", "ic sm")} Call now</a>` : ""}
        ${garage ? `<a class="btn light" href="${garage}">My Garage ${icon("arrow", "ic sm")}</a>` : p.booking ? `<a class="btn light" href="#book">Request a time</a>` : ""}
        ${fullAddress ? `<a class="btn ghost" href="${dirUrl}" target="_blank" rel="noopener">Directions</a>` : ""}
      </div>
    </div>
    ${logoUrl || stats ? `<div class="heroCard">${logoUrl ? `<img src="${esc(logoUrl)}" alt="">` : ""}${stats}</div>` : ""}
  </div>
</div>

${(p.highlights || []).length ? `<div class="strip"><ul>${p.highlights
  .map((h) => (typeof h === "string" ? { title: h, sub: "" } : h))
  .map((h, i) => `<li class="rv" style="--d:${i * 80}ms"><span class="hlIc">${icon(iconForHighlight(h.title + " " + h.sub))}</span><div><b>${esc(h.title)}</b>${h.sub ? `<span>${esc(h.sub)}</span>` : ""}</div></li>`)
  .join("")}</ul></div>` : ""}

<section id="services"><div class="wrap">
  <span class="eyebrow">Services</span>
  <h2>What we do</h2>
  <p class="sub">Drive in, or request a time and we'll have a bay ready for you.</p>
  <div class="grid">${services}</div>
</div></section>

${hasQuote ? `<section id="quote" class="dark"><div class="wrap">
  <span class="eyebrow">Instant price</span>
  <h2>What does my oil change cost?</h2>
  <p class="sub">Pick your car. We'll show the oil it takes and your price, before you leave the house.</p>
  <div class="quote">
    <div class="pick">
      <label>Year<select id="qy"><option value="">Year</option></select></label>
      <label>Make<select id="qm" disabled><option value="">Make</option></select></label>
      <label>Model<select id="qd" disabled><option value="">Model</option></select></label>
      <label>Engine<select id="qe" disabled><option value="">Engine</option></select></label>
    </div>
    <div class="result" id="qr"><div class="empty">${icon("oil")}<span>Pick your year, make and model<br>to see your price.</span></div></div>
  </div>
</div></section>` : ""}

${hasPrices ? `<section id="prices"><div class="wrap">
  <span class="eyebrow">Prices</span>
  <h2>Prices, up front</h2>
  <p class="sub">What you see is what you pay for the service. ${esc(p.taxNote || "")}</p>
  ${tiers ? `<div class="tiers">${tiers}</div>` : ""}
  ${jobRows ? `<h3 class="listHead">Fluid &amp; maintenance services</h3><ul class="list">${jobRows}</ul>` : ""}
</div></section>` : ""}

${deals ? `<section id="specials" class="alt"><div class="wrap">
  <span class="eyebrow">Save</span>
  <h2>Current specials</h2>
  <p class="sub">Show this page or mention the code at the counter.</p>
  <div class="deals">${deals}</div>
</div></section>` : ""}

<section id="about"><div class="wrap about">
  <div class="rv">
    <span class="eyebrow">About us</span>
    <h2>${esc(p.name)}</h2>
    <p class="big">${esc(about)}</p>
    ${p.ardNumber ? `<div class="badge">${icon("shield")}<div><b>State-registered repair shop</b><span>California Bureau of Automotive Repair · ${esc(p.ardNumber)}</span></div></div>` : ""}
  </div>
  <div class="rv" style="--d:120ms">${faq}</div>
</div></section>

${p.booking ? `<section id="book" class="alt"><div class="wrap">
  <span class="eyebrow">Appointments</span>
  <h2>Request a time</h2>
  <p class="sub">Tell us what you need. We'll call or text to confirm. Walk-ins are always welcome.</p>
  <div class="bookGrid rv">
    <div class="bookSide">
      <h3>Rather talk to a person?</h3>
      <p>Call us. We'll pick up and get you in.</p>
      ${p.phone ? `<a class="row" href="${tel}">${icon("phone")} ${esc(p.phone)}</a>` : ""}
      ${p.email ? `<a class="row" href="mailto:${esc(p.email)}">${icon("mail")} ${esc(p.email)}</a>` : ""}
      ${fullAddress ? `<a class="row" href="${dirUrl}" target="_blank" rel="noopener">${icon("pin")} ${esc(fullAddress)}</a>` : ""}
    </div>
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
      <div class="full"><button class="btn primary" type="submit">Send request ${icon("arrow", "ic sm")}</button></div>
    </form>
  </div>
</div></section>` : ""}

<section id="visit"><div class="wrap">
  <span class="eyebrow">Find us</span>
  <h2>Visit us</h2>
  <div class="visit">
    ${fullAddress ? `<iframe class="map" title="Map" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=${mapQ}&output=embed"></iframe>` : ""}
    <div class="visitCard">
      ${p.phone ? `<a class="row tel" href="${tel}">${esc(p.phone)}</a>` : ""}
      ${fullAddress ? `<a class="row" href="${dirUrl}" target="_blank" rel="noopener">${icon("pin", "ic sm")} ${esc(fullAddress)}</a>` : ""}
      ${p.email ? `<a class="row" href="mailto:${esc(p.email)}">${icon("mail", "ic sm")} ${esc(p.email)}</a>` : ""}
      <div class="row">${icon("clock", "ic sm")} Hours</div>
      <table id="hours">${hours}</table>
      ${fullAddress ? `<a class="btn primary sm" href="${dirUrl}" target="_blank" rel="noopener">Get directions</a>` : ""}
      ${links.length ? `<div class="social">${links.map(([k, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(linkLabel[k] || k)}</a>`).join("")}</div>` : ""}
    </div>
  </div>
</div></section>

${opts.portalUrl ? `<div class="portal"><div class="wrap"><p><b>Already a customer?</b>See your cars, what's due, and every receipt.</p><a class="btn light" href="${esc(opts.portalUrl)}">My Garage ${icon("arrow", "ic sm")}</a></div></div>` : ""}
</main>

${servicePages}

<footer><div class="wrap">
  <div class="cols">
    <div><p class="name">${esc(p.name)}</p><p>${esc(tagline)}</p></div>
    <div><h4>Contact</h4>${p.phone ? `<p><a href="${tel}">${esc(p.phone)}</a></p>` : ""}${p.email ? `<p><a href="mailto:${esc(p.email)}">${esc(p.email)}</a></p>` : ""}${fullAddress ? `<p><a href="${dirUrl}" target="_blank" rel="noopener">${esc(fullAddress)}</a></p>` : ""}</div>
    <div><h4>Hours</h4>${hoursRows(p.hoursWeek).map((r) => `<p style="margin:0 0 6px">${esc(r.days)} · ${esc(r.text)}</p>`).join("")}</div>
  </div>
  <div class="legal">
    <span>© ${new Date().getFullYear()} ${esc(p.name)}${p.ardNumber ? ` · BAR ${esc(p.ardNumber)}` : ""}</span>
    <span>Website by <a href="https://odaymia.github.io/shop-desk/" target="_blank" rel="noopener">Bolt Badger</a></span>
  </div>
</div></footer>

<div class="mbar">
  ${p.phone ? `<a class="btn primary" href="${tel}">${icon("phone", "ic sm")} Call</a>` : ""}
  ${garage ? `<a class="btn light" href="${garage}">My Garage</a>` : p.booking ? `<a class="btn light" href="#book">Book</a>` : `<a class="btn light" href="${dirUrl}">Directions</a>`}
</div>

<script>window.SITE=${jsonForScript(pageData)};</script>
<script>${CLIENT_JS}</script>
</body>
</html>`;
}

/* The page's own script: open-now badge, today's hours, the oil change
   quote, the booking form, and the scroll-in animation. Self-contained so the downloaded page works
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
  var emptyHTML=qr.innerHTML;
  var show=function(c){if(!c){qr.innerHTML=emptyHTML;return}
    var q=c[5],h='<p class="car">'+esc(c[0]+" "+c[1]+" "+c[2])+'</p><p class="spec">'+(c[3]?esc(c[3])+' · ':'')+'takes <b>'+q+' quarts</b>'+(c[4]?' of <b>'+esc(c[4])+'</b>':'')+'</p>';
    var ks=S.pkgs.map(function(k){return k[4]}),kind=c[6]||"",idx=ks.map(function(k,i){return i}).filter(function(i){return kind==="d"?ks[i]==="d":ks[i]===""||(kind==="e"&&ks[i]==="e")});if(!idx.length)idx=ks.map(function(k,i){return i});
    idx.map(function(i){return S.pkgs[i]}).forEach(function(k){var extra=Math.max(0,Math.round((Math.round(q*10)/10-k[2])*100)/100),p=Math.round((k[1]+extra*k[3])*100)/100;h+='<div class="opt"><span>'+esc(k[0])+(extra?'<br><small>includes '+extra+' extra qt</small>':'')+'</span><b>'+money(p)+'</b></div>'});
    h+='<p class="spec" style="margin:14px 0 16px;font-size:13px">Price for the oil change service before tax. We confirm your oil at the counter.</p>'+(document.getElementById("bookForm")?'<a class="btn primary" href="#book" data-svc="Oil change">Request a time</a>':'');qr.innerHTML=h};
  qy.onchange=function(){fill(qm,qy.value?uniq(pick().map(function(c){return c[1]})).sort():[],"Make");fill(qd,[],"Model");fill(qe,[],"Engine");show(null)};
  qm.onchange=function(){fill(qd,qm.value?uniq(pick().map(function(c){return c[2]})).sort():[],"Model");fill(qe,[],"Engine");show(null)};
  qd.onchange=function(){var L=qd.value?pick():[];fill(qe,uniq(L.map(function(c){return c[3]||"Standard"})),"Engine");if(L.length===1){qe.value=L[0][3]||"Standard";show(L[0])}else show(null)};
  qe.onchange=function(){var c=pick().filter(function(c){return(c[3]||"Standard")===qe.value})[0];show(c||null)};
}
document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("[data-svc]");if(!a)return;var f=$("bookForm");if(!f)return;var sel=f.elements.service,v=a.getAttribute("data-svc");for(var i=0;i<sel.options.length;i++)if(sel.options[i].text===v)sel.value=v;
  var y=qy&&qy.value,m=qm&&qm.value,d=qd&&qd.value;if(y&&m&&d&&!f.elements.vehicle.value)f.elements.vehicle.value=y+" "+m+" "+d});
var rv=document.querySelectorAll(".rv");if("IntersectionObserver" in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add("in");io.unobserve(e.target)}})},{rootMargin:"0px 0px -8% 0px"});rv.forEach(function(el){io.observe(el)})}else rv.forEach(function(el){el.classList.add("in")});
var baseTitle=document.title;function route(){var h=location.hash,el=h&&h.indexOf("#service-")===0?document.getElementById(h.slice(1)):null;if(el){window.scrollTo(0,0);document.title=el.getAttribute("data-title")||baseTitle}else document.title=baseTitle}
window.addEventListener("hashchange",route);route();
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
