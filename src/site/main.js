/* A shop's public website: /site/?s=<web address>. Fetches the page content
   the shop published (supabase/website.sql) and writes the whole document
   rendered by src/lib/siteRender.js. No sign-in, no supabase-js — one
   public read, and the booking form posts one row. */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../lib/cloudConfig.js";
import { renderSite } from "../lib/siteRender.js";

const say = (text) => {
  document.title = "Not found";
  document.getElementById("msg").textContent = text;
};

async function load() {
  const q = new URLSearchParams(location.search);
  const slug = String(q.get("s") || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!slug) return say("No shop in this address.");
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return say("This site isn't connected yet.");
  const url = `${SUPABASE_URL}/rest/v1/shop_site?select=shop_id,data&published=eq.true&slug=eq.${encodeURIComponent(slug)}`;
  const res = await fetch(url, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
  if (!res.ok) return say("This page couldn't load. Please try again in a minute.");
  const [row] = await res.json();
  if (!row) return say("We couldn't find that shop's website.");
  const html = renderSite(row.data, {
    api: { url: SUPABASE_URL, key: SUPABASE_ANON_KEY, shopId: row.shop_id },
    portalUrl: new URL("../portal/", location.href).href,
  });
  document.open();
  document.write(html);
  document.close();
}

load().catch(() => say("This page couldn't load. Please try again in a minute."));
