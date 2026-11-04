/* A shop's public website. Two ways in:

   - /site/?s=<web address>: this app's own copy. Fetches the content the
     shop published (supabase/website.sql) and writes the page rendered by
     src/lib/siteRender.js.
   - the shop's own domain: a page already rendered (the "own domain" file
     from Settings → Website) carries <meta name="bolt-badger-site"> and
     loads this script from its fixed address, site/app.js. It checks for
     newer content and redraws only if the shop has published since.

   No sign-in, no supabase-js: one public read; forms post one row each. */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../lib/cloudConfig.js";
import { renderSite } from "../lib/siteRender.js";

const here = import.meta.url;
const meta = document.querySelector('meta[name="bolt-badger-site"]');
const onOwnDomain = !!meta;

const say = (text) => {
  if (onOwnDomain) return; // the page already shows the last published copy
  document.title = "Not found";
  const el = document.getElementById("msg");
  if (el) el.textContent = text;
};

/* On a shop's own domain the host serves this bootstrap for every path, so
   /portal/ lands here too — detect it and mount the customer portal instead
   of the shop site, keeping customers on the shop's own domain. */
const isPortalPath = /(?:^|\/)portal\/?$/i.test(location.pathname);

async function loadPortal() {
  document.open();
  document.write('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>My Garage</title></head><body><div id="root"></div></body></html>');
  document.close();
  const { mountPortal } = await import("../portal/mount.jsx");
  mountPortal(document.getElementById("root"));
}

async function load() {
  if (onOwnDomain && isPortalPath) return loadPortal();
  const q = new URLSearchParams(location.search);
  const slug = String((meta && meta.content) || q.get("s") || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!slug) return say("No shop in this address.");
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return say("This site isn't connected yet.");
  const url = `${SUPABASE_URL}/rest/v1/shop_site?select=shop_id,data&published=eq.true&slug=eq.${encodeURIComponent(slug)}`;
  const res = await fetch(url, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
  if (!res.ok) return say("This page couldn't load. Please try again in a minute.");
  const [row] = await res.json();
  if (!row) {
    /* the shop's website add-on is off: a copy of the page kept anywhere
       (its own domain, a saved file) stops showing the shop, instead of
       living on with old prices and a form that goes nowhere */
    if (onOwnDomain) {
      document.open();
      document.write('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Website not active</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f5f0;color:#15171b;font:17px/1.6 system-ui,-apple-system,sans-serif;text-align:center;padding:24px}h1{font-size:24px;margin:0 0 8px}p{color:#5b616c;margin:0}</style></head><body><div><h1>This website isn\'t active right now</h1><p>Please check back soon.</p></div></body></html>');
      document.close();
      return;
    }
    return say("We couldn't find that shop's website.");
  }
  /* on the shop's domain, the page is already drawn; redraw only when the
     shop has published something newer than this copy */
  if (onOwnDomain && window.SITE && window.SITE.updatedAt === row.data.updatedAt) return;
  const html = renderSite(row.data, {
    api: { url: SUPABASE_URL, key: SUPABASE_ANON_KEY, shopId: row.shop_id },
    /* on the shop's own domain, keep the portal link on that domain
       (/portal/ is served by this same bootstrap); on the app host, use the
       app's own portal build */
    portalUrl: row.data.portal === false ? "" : (onOwnDomain ? new URL("/portal/", location.origin).href : new URL("../portal/", here).href),
    live: onOwnDomain ? { src: here, slug, canonical: (document.querySelector('link[rel="canonical"]') || {}).href || "" } : null,
  });
  document.open();
  document.write(html);
  document.close();
}

load().catch(() => say("This page couldn't load. Please try again in a minute."));
