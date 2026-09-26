/* Turns the shop's settings plus what the owner built (blocks) into a
   finished email (subject, HTML, text) for a campaign or an automation:
   links resolved to the shop's own pages, coupons and services looked up,
   hours and directions filled in. Pure. */
import { renderEmail } from "./emailRender.js";
import { offerSlug, couponText, hoursRows, parseHoursText, slugify } from "./website.js";
import { specBlocks, emailPhotoUrl, DEFAULT_THEME } from "./emailBlocks.js";
import { serviceContent } from "./serviceContent.js";

const str = (s) => String(s == null ? "" : s).trim();

/* Where the site lives: the shop's own domain once it has one. */
export function siteHome(cfg, appBase) {
  const w = (cfg && cfg.website) || {};
  if (str(w.domain)) return `https://${str(w.domain).replace(/^https?:\/\//, "").replace(/\/.*$/, "")}/`;
  return w.slug && appBase ? `${appBase}site/?s=${encodeURIComponent(w.slug)}` : "";
}
const withQuery = (base, q) => (base ? `${base.replace(/#.*$/, "")}${base.includes("?") ? "&" : "?"}${q}` : "");
const withHash = (base, h) => (base ? `${base.replace(/#.*$/, "")}#${h}` : "");

/* The shop as the email shows it. An uploaded logo is stored as a data: URL,
   which mail apps block, so those shops get their name in the header;
   `logoUrl` is a hosted copy when there is one. */
export function emailBrand(cfg, { logoUrl = "", appBase = "" } = {}) {
  const w = (cfg && cfg.website) || {};
  const logo = /^https?:\/\//.test(str(cfg.logo)) ? str(cfg.logo) : logoUrl;
  return {
    name: str(cfg.shopName),
    logo,
    color: w.brandColor || "#8e2f2f",
    address: [str(cfg.shopAddress), str(w.cityLine)].filter(Boolean).join(", "),
    phone: str(cfg.shopPhone),
    website: siteHome(cfg, appBase),
    links: w.links || {},
  };
}

const couponLine = (c) => str(c.name).replace(/^\$?\d+(\.\d+)?%?\s*off\b[\s:,-]*/i, "");

/* spec: { subject, preheader, theme, blocks } — or the older headline/body/
   couponId/button shape, which becomes blocks.
   opts.services: [{ id, name, slug, from, oil }] from the shop's service
   menu, for Services blocks (the desk builds it once from its records). */
export function composeEmail(cfg, coupons, spec, opts = {}) {
  const w = (cfg && cfg.website) || {};
  const home = siteHome(cfg, opts.appBase);
  const blocks = specBlocks(spec);
  /* the email's coupon: the first coupon block's, for "offer" links */
  const firstCoupon = blocks.map((b) => b.type === "coupon" && coupons && coupons[b.couponId]).find(Boolean) || null;
  const offerOf = (c) => (c && w.offers && w.offers[c.id] ? withQuery(home, `offer=${encodeURIComponent(offerSlug(c))}`) : c ? withHash(home, "specials") : "");
  const review = str(w.links && w.links.google);
  const link = (kind, url) => {
    if (kind === "custom") return str(url);
    if (kind === "review") return review || home;
    if (kind === "offer") return offerOf(firstCoupon) || home;
    if (kind === "site") return home;
    return "";
  };
  const services = opts.services || [];
  const addr = [str(cfg.shopAddress), str(w.cityLine)].filter(Boolean).join(", ");
  const dirUrl = addr ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent([cfg.shopName, addr].filter(Boolean).join(", "))}` : "";
  const week = w.hoursWeek || (cfg.hours ? parseHoursText(cfg.hours) : null);

  const resolved = blocks.map((b, i) => {
    switch (b.type) {
      case "hero":
        return { type: "hero", img: emailPhotoUrl(b.photo, 1200, 600), headline: b.headline, text: b.text, buttonLabel: b.buttonLabel, url: link(b.link, b.url) };
      case "text":
        return { type: "text", title: b.title, text: b.text, big: i === 0 };
      case "coupon": {
        const c = coupons && coupons[b.couponId];
        return c ? { type: "coupon", off: couponText(c), line: couponLine(c), code: str(c.code), endsAt: c.endsAt || "", note: b.note, url: offerOf(c) } : { type: "coupon" };
      }
      case "services": {
        const picked = (b.ids && b.ids.length ? b.ids.map((id) => services.find((s) => s.id === id)) : services.slice(0, 2)).filter(Boolean).slice(0, 4);
        return {
          type: "services",
          title: b.title,
          items: picked.map((s) => ({ name: s.name, from: s.from, url: withHash(home, `service-${s.slug || slugify(s.name)}`), img: emailPhotoUrl(serviceContent(s.oil ? "oil change" : s.name).photo.id, 504, 300) })),
        };
      }
      case "split":
        return { type: "split", img: emailPhotoUrl(b.photo, 504, 380), title: b.title, text: b.text, buttonLabel: b.buttonLabel, url: link(b.link, b.url), flip: !!b.flip };
      case "image":
        return { type: "image", img: emailPhotoUrl(b.photo, 1056, 600), caption: b.caption, url: link(b.link, b.url) };
      case "review":
        return { type: "review", quote: b.quote, name: b.name, stars: b.stars };
      case "button":
        return { type: "button", label: str(b.label) || (b.link === "review" ? "Leave us a review" : "Visit our website"), url: link(b.link, b.url) };
      case "visit":
        return { type: "visit", title: b.title, address: addr, hours: week ? hoursRows(week) : [], dirUrl };
      default:
        return { type: b.type };
    }
  });

  const brand = emailBrand(cfg, opts);
  const firstText = resolved.find((b) => b.headline || b.title);
  const pre = str(spec && spec.preheader) || (firstCoupon ? `${couponText(firstCoupon).toUpperCase()} ${couponLine(firstCoupon)}`.trim() : "");
  const { html, text } = renderEmail(brand, { subject: spec && spec.subject, preheader: pre, theme: { ...DEFAULT_THEME, ...((spec && spec.theme) || {}) }, blocks: resolved });
  return { subject: str(spec && spec.subject) || str(firstText && (firstText.headline || firstText.title)) || brand.name, html, text };
}
