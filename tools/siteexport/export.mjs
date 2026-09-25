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

const args = process.argv.slice(2);
const flag = (name) => (args.find((a) => a.startsWith(`--${name}=`)) || "").split("=")[1] || "";
const [slug, domain, out, ...moves] = args.filter((a) => !a.startsWith("--"));
/* the policies' "effective" date: keep the same one on every rebuild until
   the wording changes (--policy-date=YYYY-MM-DD) */
const policyDate = flag("policy-date") || new Date().toISOString().slice(0, 10);
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
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${home}</loc></url>\n  <url><loc>${home}policies/privacy-policy/</loc></url>
  <url><loc>${home}policies/cookie-policy/</loc></url>\n</urlset>\n`);

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
const when = new Date(policyDate + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const contactLines = [esc(p.name), addr && esc(addr), p.phone && esc(p.phone), p.email && `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>`].filter(Boolean).join("<br>");
const reach = [p.email && `email <a href="mailto:${esc(p.email)}">${esc(p.email)}</a>`, p.phone && `call ${esc(p.phone)}`].filter(Boolean).join(" or ");
const policyPage = (title, canonicalPath, body) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(p.name)}</title>
<meta name="description" content="${esc(title)} for ${esc(p.name)}.">
<link rel="canonical" href="${esc(home)}${canonicalPath}">
<style>
body{margin:0;background:#f7f5f0;color:#15171b;font:17px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:780px;margin:0 auto;padding:48px 24px 80px}
h1{font-size:36px;line-height:1.1;margin:0 0 6px}
h2{font-size:21px;margin:34px 0 8px}
a{color:${esc(p.accentColor || "#1e8fd0")}}
.muted{color:#5b616c}
ul{padding-left:22px}li{margin:4px 0}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e7e3dc;border-radius:12px;overflow:hidden;font-size:15px}
th,td{text-align:left;padding:10px 12px;border-top:1px solid #e7e3dc;vertical-align:top}th{background:#fbfaf7;border-top:0}
.box{background:#fff;border:1px solid #e7e3dc;border-radius:12px;padding:16px 18px}
nav{display:flex;gap:18px;flex-wrap:wrap;margin-bottom:26px;font-weight:600}
</style>
</head><body><main>
<nav><a href="/">← ${esc(p.name)}</a><a href="/policies/privacy-policy/">Privacy policy</a><a href="/policies/cookie-policy/">Cookie policy</a></nav>
<h1>${esc(title)}</h1>
<p class="muted">Effective ${esc(when)}</p>
${body}
<h2>Contact us</h2>
<div class="box">${contactLines}</div>
</main></body></html>
`;

write(
  "policies/privacy-policy/index.html",
  policyPage(
    "Privacy policy",
    "policies/privacy-policy/",
    `<p>${esc(p.name)} ("we," "us") runs this website and our auto service shop. This policy explains what personal information we collect, how we use it, and the choices you have. It applies to this website and to the records we keep when you're our customer.</p>

<h2>Information we collect</h2>
<table>
<tr><th>What</th><th>When</th></tr>
<tr><td>Name, phone number, email address</td><td>When you request an appointment, claim an offer, sign up for our emails, or become a customer</td></tr>
<tr><td>Vehicle details (year, make, model, mileage, VIN, license plate)</td><td>When you tell us about your car or we service it</td></tr>
<tr><td>Notes you send us</td><td>When you describe a problem or a request on this site</td></tr>
<tr><td>Service history, estimates, invoices, and payments</td><td>When we work on your vehicle</td></tr>
<tr><td>Basic technical information (like your IP address and browser type)</td><td>Automatically, when your browser loads this site and the services it uses (see "Services we use" below)</td></tr>
</table>
<p>We don't collect payment card numbers through this website.</p>

<h2>How we use it</h2>
<ul>
<li>To answer your requests and set up your appointments</li>
<li>To do the work on your car and keep your service history, which you can see in My Garage</li>
<li>To send service reminders</li>
<li>To send specials and coupons, if you signed up or are our customer. You can stop these anytime (see "Your choices")</li>
<li>To keep records the law requires of auto repair shops, and to protect against fraud</li>
</ul>

<h2>Who we share it with</h2>
<p><b>We never sell or rent your personal information.</b> We share it only with:</p>
<ul>
<li><b>Service providers</b> who run our shop software, website, and email for us, only as needed to provide those services</li>
<li><b>Anyone you ask us to share it with</b></li>
<li><b>Authorities</b>, when the law requires it</li>
</ul>

<h2>Services we use on this site</h2>
<p>This site loads a few things from other companies. When it does, your browser connects to them directly, and they may receive your IP address and browser information under their own privacy policies:</p>
<ul>
<li><b>Google Maps</b>: the map on our page (<a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google privacy policy</a>)</li>
<li><b>Google Fonts</b>: the lettering on this site (<a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google privacy policy</a>)</li>
<li><b>Unsplash</b>: some of the photos (<a href="https://unsplash.com/privacy" target="_blank" rel="noopener">Unsplash privacy policy</a>)</li>
<li><b>Supabase and GitHub</b>: they host our site and securely store what you send us</li>
</ul>
<p>We don't use advertising trackers or analytics on this site. See our <a href="/policies/cookie-policy/">cookie policy</a>.</p>

<h2>Your choices</h2>
<ul>
<li><b>Emails:</b> every marketing email has an unsubscribe link. You can also ${reach || "contact us"} and we'll take you off the list.</li>
<li><b>See or correct your information:</b> ${reach ? reach.charAt(0).toUpperCase() + reach.slice(1) : "Contact us"} to ask what we have about you, or to fix anything that's wrong. Customers can also see their cars and receipts in My Garage.</li>
<li><b>Deletion:</b> you can ask us to delete your information. We'll delete what we're allowed to. Some repair records must be kept by law.</li>
</ul>

<h2>California residents</h2>
<p>If you live in California, you have the right to know what personal information we collect and how we use and share it, to ask us to delete or correct it, and not to be treated differently for using these rights. We do not sell or share personal information for cross-context behavioral advertising. To make a request, contact us using the details below. We'll need to confirm it's you before we act on a request.</p>

<h2>Do Not Track</h2>
<p>Some browsers send a "Do Not Track" signal. Because this site doesn't track you across other websites, it works the same whether or not that signal is on.</p>

<h2>How long we keep it</h2>
<p>We keep customer and repair records for as long as needed to serve you and as the law requires. We keep email signups until you unsubscribe or ask us to delete them.</p>

<h2>How we protect it</h2>
<p>This site uses a secure (https) connection, and what you send us is stored with a provider that encrypts it and limits who can see it. No system is perfectly secure, but we work to keep your information safe.</p>

<h2>Children</h2>
<p>This site isn't meant for children under 13, and we don't knowingly collect their information.</p>

<h2>Changes to this policy</h2>
<p>If we change this policy, we'll post the new version here and update the effective date at the top.</p>`
  )
);

write(
  "policies/cookie-policy/index.html",
  policyPage(
    "Cookie policy",
    "policies/cookie-policy/",
    `<p>Cookies are small files a website stores in your browser. This page explains which ones you'll find on our site. The short version: <b>we don't set any cookies of our own, and we don't use advertising or analytics trackers.</b></p>

<h2>Cookies we set</h2>
<p>None. Our pages work without storing anything in your browser.</p>

<h2>Cookies from services on our pages</h2>
<table>
<tr><th>Service</th><th>What it's for</th><th>Cookies</th></tr>
<tr><td>Google Maps</td><td>The map showing where we are</td><td>Google may set cookies when the map loads, for example to remember settings and to protect against abuse. See <a href="https://policies.google.com/technologies/cookies" target="_blank" rel="noopener">how Google uses cookies</a>.</td></tr>
<tr><td>Google Fonts</td><td>The lettering on the site</td><td>No cookies. Your browser requests the font files from Google.</td></tr>
<tr><td>Unsplash</td><td>Some of our photos</td><td>No cookies. Your browser requests the images from Unsplash.</td></tr>
</table>

<h2>Other things we store</h2>
<p>When you send us a form (an appointment request, an offer, or an email signup), what you type is sent to us and stored securely on our side, not in your browser. See our <a href="/policies/privacy-policy/">privacy policy</a>.</p>
<p>If you're our customer and sign in to My Garage, that sign-in is kept in your browser so you stay signed in. It's needed for the sign-in to work and isn't used to track you.</p>

<h2>Your choices</h2>
<p>You can block or delete cookies in your browser's settings. Our site still works without them, but the map may not show if you block Google's cookies. You can always use the "Get directions" button instead.</p>

<h2>Changes</h2>
<p>If we add a service that uses cookies, we'll update this page and the effective date at the top.</p>`
  )
);
console.log(`wrote ${out} for ${domain} (published ${new Date(p.updatedAt).toISOString()})`);
