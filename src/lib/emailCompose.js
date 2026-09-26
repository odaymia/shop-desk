/* Turns the shop's settings plus what the owner wrote into a finished email
   (subject, HTML, text) for a campaign or an automation. Pure. */
import { renderEmail } from "./emailRender.js";
import { offerSlug, couponText } from "./website.js";

const str = (s) => String(s == null ? "" : s).trim();

/* Where the site lives: the shop's own domain once it has one. */
export function siteHome(cfg, appBase) {
  const w = (cfg && cfg.website) || {};
  if (str(w.domain)) return `https://${str(w.domain).replace(/^https?:\/\//, "").replace(/\/.*$/, "")}/`;
  return w.slug && appBase ? `${appBase}site/?s=${encodeURIComponent(w.slug)}` : "";
}
const withQuery = (base, q) => (base ? `${base}${base.includes("?") ? "&" : "?"}${q}` : "");

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
  };
}

/* spec: { subject, preheader, headline, body, couponId, button: "site" | "review" | "offer" | "custom" | "", buttonLabel, buttonUrl } */
export function composeEmail(cfg, coupons, spec, opts = {}) {
  const w = (cfg && cfg.website) || {};
  const home = siteHome(cfg, opts.appBase);
  const c = spec.couponId && coupons ? coupons[spec.couponId] : null;
  const coupon = c ? { off: couponText(c), line: str(c.name).replace(/^\$?\d+(\.\d+)?%?\s*off\b[\s:,-]*/i, "") || "", code: str(c.code), endsAt: c.endsAt || "" } : null;
  const offerUrl = c && w.offers && w.offers[c.id] ? withQuery(home, `offer=${encodeURIComponent(offerSlug(c))}`) : "";
  const review = str(w.links && w.links.google);
  let button = null;
  const kind = spec.button || "";
  if (kind === "custom" && str(spec.buttonUrl)) button = { label: str(spec.buttonLabel) || "Learn more", url: str(spec.buttonUrl) };
  else if (kind === "review") button = review ? { label: str(spec.buttonLabel) || "Leave us a review", url: review } : home ? { label: "Visit our website", url: home } : null;
  else if (kind === "site" || kind === "offer") {
    const url = offerUrl || (c ? `${home}${home.includes("#") ? "" : "#specials"}` : home);
    button = url ? { label: str(spec.buttonLabel) || (c ? "See the offer" : "Visit our website"), url } : null;
  }
  const brand = emailBrand(cfg, opts);
  const { html, text } = renderEmail(brand, { subject: spec.subject, preheader: spec.preheader || (coupon ? `${coupon.off.toUpperCase()} ${coupon.line}`.trim() : ""), headline: spec.headline, body: spec.body, coupon, button });
  return { subject: str(spec.subject) || str(spec.headline) || brand.name, html, text };
}
