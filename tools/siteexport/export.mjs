/* Builds the folder a shop's own domain serves (GitHub Pages or any static
   host) from the site the shop published in Shop Desk:

     node tools/siteexport/export.mjs <slug> <domain> <out-dir> [old-path=target ...]

   - index.html: the whole site, rendered, so Google reads it; it loads
     site/app.js from the Shop Desk deploy, which redraws the page when the
     shop publishes something newer
   - CNAME for GitHub Pages, 404.html, robots.txt, sitemap.xml
   - a redirect page for each old address the shop's previous site had
     (old-path=#service-brakes), so search results and bookmarks still land
   - a plain privacy policy (the site collects emails and phone numbers)

   Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from .env. */
import fs from "node:fs";
import path from "node:path";
import { renderSite } from "../../src/lib/siteRender.js";

const [slug, domain, out, ...moves] = process.argv.slice(2);
if (!slug || !domain || !out) {
  console.error("usage: node tools/siteexport/export.mjs <slug> <domain> <out-dir> [old-path=target ...]");
  process.exit(1);
}
const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../../.env", import.meta.url), "utf8")
    .split("\n")
    .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")])
);
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY;
const APP = "https://odaymia.github.io/shop-desk/";

const res = await fetch(`${url}/rest/v1/shop_site?select=shop_id,data&published=eq.true&slug=eq.${encodeURIComponent(slug)}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
const [row] = await res.json();
if (!row) throw new Error(`No published site "${slug}"`);
const p = row.data;
const home = `https://${domain}/`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const write = (rel, text) => {
  const f = path.join(out, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};

write(
  "index.html",
  renderSite(p, {
    api: { url, key, shopId: row.shop_id },
    portalUrl: `${APP}portal/`,
    live: { src: `${APP}site/app.js`, slug, canonical: home },
  })
);
write("CNAME", domain + "\n");
write(".nojekyll", "");
write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${home}sitemap.xml\n`);
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${home}</loc></url>\n  <url><loc>${home}policies/privacy-policy/</loc></url>\n</urlset>\n`);

const redirect = (target) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(p.name)}</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="${esc(home)}">
<meta http-equiv="refresh" content="0; url=/${esc(target)}">
<script>location.replace("/${target.replace(/"/g, "")}")</script>
</head><body><a href="/${esc(target)}">${esc(p.name)}</a></body></html>
`;
write("404.html", redirect(""));
for (const m of moves) {
  const [from, to = ""] = m.split("=");
  write(path.join(from.replace(/^\/+|\/+$/g, ""), "index.html"), redirect(to));
}

const addr = [p.address, p.cityLine].filter(Boolean).join(", ");
write(
  "policies/privacy-policy/index.html",
  `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy policy · ${esc(p.name)}</title>
<link rel="canonical" href="${esc(home)}policies/privacy-policy/">
<style>body{margin:0;background:#f7f5f0;color:#15171b;font:17px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}main{max-width:760px;margin:0 auto;padding:48px 24px 80px}h1{font-size:34px;margin:0 0 6px}h2{font-size:21px;margin:32px 0 8px}a{color:${esc(p.accentColor || "#1e8fd0")}}.muted{color:#5b616c}</style>
</head><body><main>
<p><a href="/">← ${esc(p.name)}</a></p>
<h1>Privacy policy</h1>
<p class="muted">${esc(p.name)}${addr ? ` · ${esc(addr)}` : ""}</p>
<h2>What we collect</h2>
<p>When you ask for an appointment, claim an offer, or sign up for our emails on this site, we keep what you type in: your name, phone number, email, vehicle, and notes. When you're a customer, we keep the records of the work we do on your car.</p>
<h2>How we use it</h2>
<p>To contact you about your appointment or request, to keep your service history, and, if you signed up or are a customer, to send you specials and service reminders. We never sell or rent your information.</p>
<h2>Emails</h2>
<p>Every marketing email has an unsubscribe link. You can also ask us to take you off the list any time${p.email ? ` at <a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ""}${p.phone ? ` or ${esc(p.phone)}` : ""}.</p>
<h2>Who else sees it</h2>
<p>Only the services that run this site and our shop software, and only to provide them to us. Maps on this site are from Google, and photos from Unsplash.</p>
<h2>Your choices</h2>
<p>California residents can ask what we have about them, and ask us to correct or delete it. Contact us and we'll take care of it.</p>
<h2>Contact</h2>
<p>${esc(p.name)}${addr ? `<br>${esc(addr)}` : ""}${p.phone ? `<br>${esc(p.phone)}` : ""}${p.email ? `<br><a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ""}</p>
</main></body></html>
`
);
console.log(`wrote ${out} for ${domain} (published ${new Date(p.updatedAt).toISOString()})`);
