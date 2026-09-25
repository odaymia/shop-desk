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

async function load() {
  const q = new URLSearchParams(location.search);
  const slug = String((meta && meta.content) || q.get("s") || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!slug) return say("No shop in this address.");
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return say("This site isn't connected yet.");
  const url = `${SUPABASE_URL}/rest/v1/shop_site?select=shop_id,data&published=eq.true&slug=eq.${encodeURIComponent(slug)}`;
  const res = await fetch(url, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
  if (!res.ok) return say("This page couldn't load. Please try again in a minute.");
  const [row] = await res.json();
  if (!row) return say("We couldn't find that shop's website.");
  /* on the shop's domain, the page is already drawn; redraw only when the
     shop has published something newer than this copy */
  if (onOwnDomain && window.SITE && window.SITE.updatedAt === row.data.updatedAt) return;
  const html = renderSite(row.data, {
    api: { url: SUPABASE_URL, key: SUPABASE_ANON_KEY, shopId: row.shop_id },
    portalUrl: row.data.portal === false ? "" : new URL("../portal/", here).href,
    live: onOwnDomain ? { src: here, slug, canonical: (document.querySelector('link[rel="canonical"]') || {}).href || "" } : null,
  });
  document.open();
  document.write(html);
  document.close();
}

load().catch(() => say("This page couldn't load. Please try again in a minute."));
