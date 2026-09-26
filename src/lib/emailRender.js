/* The shop's marketing email, drawn from blocks, as HTML every mail app
   draws the same way: tables and inline styles, a <style> block only for
   phone widths and hover (apps that drop it still get the full email), no
   scripts, no background images, no data: images. Pure — returns strings.

   Personal bits stay as placeholders the sending server fills in per
   person, so one copy of the email serves the whole list:
     {first_name}        "Ana", or "there" when we don't know it
     {vehicle} {due_date} used by the oil change reminder
     {unsubscribe_url}   a signed link only the server can make
   The shop's own text can use {first_name} too ("Hi {first_name},").

   renderEmail takes blocks already filled in by emailCompose.js (links
   resolved, coupons and services looked up). An older message shape —
   headline, body, coupon, button — still works. */

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const str = (s) => String(s == null ? "" : s).trim();
const safeUrl = (u) => (/^https?:\/\//i.test(str(u)) ? str(u) : "");
const color = (c, d) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : d);

export const PLACEHOLDERS = ["first_name", "vehicle", "due_date", "unsubscribe_url"];

const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
const INK = "#15171b";
const BODY = "#3d434c";
const MUTED = "#6b7078";
const LINE = "#e6e8ec";

/* Paragraphs from the owner's text: a blank line starts a new one. */
const paragraphs = (t) =>
  str(t)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
const paras = (t, style = "") => paragraphs(t).map((p) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:${BODY};${style}">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");

/* the older shape → blocks, so a message without blocks still renders */
function legacyBlocks(m) {
  const out = [];
  if (str(m.headline) || str(m.body)) out.push({ type: "text", title: m.headline, text: m.body, big: true });
  if (m.coupon && str(m.coupon.off)) out.push({ type: "coupon", ...m.coupon, note: "Show this email at the counter." });
  if (m.button && safeUrl(m.button.url) && str(m.button.label)) out.push({ type: "button", label: m.button.label, url: m.button.url });
  return out;
}

/* brand: { name, logo, color, address, phone, website, links: { google, yelp, facebook, instagram } }
   msg:   { subject, preheader, theme: { header, corners }, blocks: [...] }   (or the older shape) */
export function renderEmail(brand, msg) {
  const b = brand || {};
  const m = msg || {};
  const theme = { header: "dark", corners: "rounded", ...(m.theme || {}) };
  /* the email's accent: a holiday color, or the shop's brand color */
  const main = color(theme.color, color(b.color, "#8e2f2f"));
  const r = theme.corners === "square" ? 0 : 16;
  const rs = theme.corners === "square" ? 0 : 10;
  const logo = safeUrl(b.logo);
  const site = safeUrl(b.website);
  const blocks = Array.isArray(m.blocks) ? m.blocks : legacyBlocks(m);
  const tel = str(b.phone).replace(/[^\d+]/g, "");

  const btn = (label, url, style = "") =>
    safeUrl(url) && str(label)
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;${style}"><tr><td style="border-radius:${theme.corners === "square" ? 0 : 999}px;background:${main}" class="btn"><a href="${esc(safeUrl(url))}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:${theme.corners === "square" ? 0 : 999}px">${esc(label)} &rarr;</a></td></tr></table>`
      : "";
  const img = (src, alt, h, extra = "") => `<img src="${esc(src)}" alt="${esc(alt)}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;${extra}">`;
  const pad = (html, p = "28px 36px") => `<tr><td class="px" style="padding:${p}">${html}</td></tr>`;

  const parts = blocks.map((k, i) => {
    const first = i === 0;
    switch (k.type) {
      case "hero": {
        const src = safeUrl(k.img);
        return `${src ? `<tr><td style="padding:0">${k.url ? `<a href="${esc(safeUrl(k.url))}">` : ""}${img(src, k.headline || "", 300)}${k.url ? "</a>" : ""}</td></tr>` : ""}
${pad(`${str(k.headline) ? `<h1 class="h1" style="margin:0 0 12px;font-family:${FONT};font-size:32px;line-height:1.12;font-weight:800;letter-spacing:-0.02em;color:${INK}">${esc(k.headline)}</h1>` : ""}${paras(k.text, "font-size:17px")}${btn(k.buttonLabel, k.url)}`, first && !src ? "36px 36px 24px" : "28px 36px 12px")}`;
      }
      case "text":
        return pad(`${str(k.title) ? `<h2 style="margin:0 0 12px;font-family:${FONT};font-size:${k.big ? 28 : 22}px;line-height:1.2;font-weight:800;letter-spacing:-0.01em;color:${INK}">${esc(k.title)}</h2>` : ""}${paras(k.text)}`, "20px 36px 8px");
      case "coupon": {
        if (!str(k.off)) return "";
        const body = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px dashed ${main};border-radius:${rs}px;background:#ffffff"><tr>
<td class="stack" style="padding:20px 22px;vertical-align:middle">
<div style="font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${MUTED}">Coupon</div>
<div style="font-family:${FONT};font-size:40px;line-height:1;font-weight:900;letter-spacing:-0.02em;color:${main};margin-top:4px">${esc(str(k.off).toUpperCase())}</div>
${str(k.line) ? `<div style="font-family:${FONT};font-size:15px;font-weight:700;color:${INK};margin-top:6px;text-transform:uppercase;letter-spacing:0.02em">${esc(k.line)}</div>` : ""}
</td>
<td class="stack" align="right" style="padding:20px 22px;vertical-align:middle;font-family:${FONT};font-size:13px;line-height:1.5;color:${MUTED}">
${str(k.note) ? `${esc(k.note)}<br>` : ""}${str(k.code) ? `Code ${esc(k.code)}<br>` : ""}${str(k.endsAt) ? `Ends ${esc(k.endsAt)}` : ""}
${safeUrl(k.url) ? `<div style="margin-top:8px"><a href="${esc(safeUrl(k.url))}" style="color:${main};font-weight:700;text-decoration:none">Get the coupon &rarr;</a></div>` : ""}
</td></tr></table>`;
        return pad(body, "14px 36px");
      }
      case "services": {
        const items = (k.items || []).filter((x) => str(x.name));
        if (!items.length) return "";
        const tiles = items
          .map(
            (x) => `<div class="tile" style="display:inline-block;width:100%;max-width:252px;vertical-align:top;margin:0 6px 14px;text-align:left">
<a href="${esc(safeUrl(x.url) || site || "#")}" style="text-decoration:none;color:${INK};display:block;border:1px solid ${LINE};border-radius:${rs}px;overflow:hidden;background:#ffffff">
${safeUrl(x.img) ? `<img src="${esc(safeUrl(x.img))}" alt="" width="252" style="display:block;width:100%;height:auto;border:0">` : ""}
<div style="padding:12px 14px 14px;font-family:${FONT}">
<div style="font-size:16px;font-weight:800;color:${INK}">${esc(x.name)}</div>
<div style="font-size:13px;color:${MUTED};margin-top:2px">${x.from != null ? `from <b style="color:${INK}">$${Number(x.from).toFixed(2)}</b>` : "Ask us for a price"}</div>
<div style="font-size:13px;font-weight:700;color:${main};margin-top:8px">Learn more &rarr;</div>
</div></a></div>`
          )
          .join("");
        return pad(`${str(k.title) ? `<h2 style="margin:0 0 14px;font-family:${FONT};font-size:20px;font-weight:800;color:${INK}">${esc(k.title)}</h2>` : ""}<div style="text-align:center;font-size:0;margin:0 -6px">${tiles}</div>`, "18px 36px 4px");
      }
      case "split": {
        const src = safeUrl(k.img);
        const pic = src ? `<div class="col" style="display:inline-block;width:100%;max-width:252px;vertical-align:middle;margin:0 6px 12px"><img src="${esc(src)}" alt="" width="252" style="display:block;width:100%;height:auto;border:0;border-radius:${rs}px"></div>` : "";
        const words = `<div class="col" style="display:inline-block;width:100%;max-width:252px;vertical-align:middle;margin:0 6px 12px;text-align:left;font-size:16px">${str(k.title) ? `<h2 style="margin:0 0 10px;font-family:${FONT};font-size:22px;line-height:1.2;font-weight:800;color:${INK}">${esc(k.title)}</h2>` : ""}${paras(k.text)}${btn(k.buttonLabel, k.url)}</div>`;
        return pad(`<div style="text-align:center;font-size:0;margin:0 -6px">${k.flip ? words + pic : pic + words}</div>`, "18px 36px 8px");
      }
      case "image": {
        const src = safeUrl(k.img);
        if (!src) return "";
        const pic = `<img src="${esc(src)}" alt="${esc(k.caption)}" width="528" style="display:block;width:100%;height:auto;border:0;border-radius:${rs}px">`;
        return pad(`${safeUrl(k.url) ? `<a href="${esc(safeUrl(k.url))}">${pic}</a>` : pic}${str(k.caption) ? `<p style="margin:8px 0 0;font-family:${FONT};font-size:13px;color:${MUTED};text-align:center">${esc(k.caption)}</p>` : ""}`, "14px 36px");
      }
      case "review": {
        if (!str(k.quote)) return "";
        const stars = Math.max(0, Math.min(5, Number(k.stars) || 5));
        return pad(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;border-radius:${rs}px"><tr><td style="padding:24px 26px;font-family:${FONT}">
<div style="font-size:18px;letter-spacing:3px;color:#f5a623">${"&#9733;".repeat(stars)}</div>
<div style="font-size:19px;line-height:1.5;font-weight:600;color:${INK};margin-top:8px">&ldquo;${esc(k.quote)}&rdquo;</div>
${str(k.name) ? `<div style="font-size:14px;color:${MUTED};margin-top:10px">${esc(k.name)}</div>` : ""}
</td></tr></table>`, "14px 36px");
      }
      case "button":
        return pad(`<div align="center">${btn(k.label, k.url, "margin:0 auto")}</div>`, "14px 36px 18px");
      case "visit": {
        const hours = (k.hours || []).map((h) => `<tr><td style="padding:4px 0;font-size:14px;color:${BODY}">${esc(h.days)}</td><td align="right" style="padding:4px 0;font-size:14px;color:${INK};font-weight:600">${esc(h.text)}</td></tr>`).join("");
        return pad(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#15171b;border-radius:${rs}px"><tr><td style="padding:24px 26px;font-family:${FONT};color:#ffffff">
<div style="font-size:20px;font-weight:800">${esc(k.title || "Come see us")}</div>
<div style="font-size:14px;color:#c9ced6;margin-top:6px">${esc(k.address)}</div>
${tel ? `<div style="margin-top:4px"><a href="tel:${esc(tel)}" style="color:#ffffff;font-weight:700;text-decoration:none;font-size:15px">${esc(b.phone)}</a></div>` : ""}
${hours ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;background:#ffffff;border-radius:${Math.max(0, rs - 2)}px"><tr><td style="padding:10px 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:${FONT}">${hours}</table></td></tr></table>` : ""}
${safeUrl(k.dirUrl) ? `<div style="margin-top:16px"><a href="${esc(safeUrl(k.dirUrl))}" style="display:inline-block;background:${main};color:#ffffff;font-weight:700;font-size:15px;text-decoration:none;padding:11px 20px;border-radius:${theme.corners === "square" ? 0 : 999}px">Get directions &rarr;</a></div>` : ""}
</td></tr></table>`, "14px 36px");
      }
      case "divider":
        return pad(`<div style="border-top:1px solid ${LINE};font-size:0;line-height:0">&nbsp;</div>`, "10px 36px");
      default:
        return "";
    }
  });

  const head =
    theme.header === "light"
      ? { bg: "#ffffff", fg: INK, border: `border-bottom:1px solid ${LINE};` }
      : theme.header === "brand"
        ? { bg: main, fg: "#ffffff", border: "" }
        : { bg: "#121417", fg: "#ffffff", border: `border-bottom:4px solid ${main};` };
  const socials = Object.entries(b.links || {})
    .map(([k, u]) => [k, safeUrl(u)])
    .filter(([, u]) => u)
    .map(([k, u]) => `<a href="${esc(u)}" style="color:${MUTED};text-decoration:none;font-weight:600">${esc({ google: "Google", yelp: "Yelp", facebook: "Facebook", instagram: "Instagram" }[k] || k)}</a>`)
    .join(" &nbsp;&middot;&nbsp; ");

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">
<title>${esc(m.subject || b.name)}</title>
<style>
@media (max-width:620px){
  .px{padding-left:20px!important;padding-right:20px!important}
  .h1{font-size:27px!important}
  .tile,.col{max-width:100%!important;margin-left:0!important;margin-right:0!important}
  .stack{display:block!important;width:100%!important;text-align:left!important}
  .wrapper{border-radius:0!important}
}
a.tilelink:hover{opacity:.9}
.btn:hover{filter:brightness(1.08)}
</style></head>
<body style="margin:0;padding:0;background:#eef0f3;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(m.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0f3"><tr><td align="center" style="padding:24px 10px">
<table role="presentation" class="wrapper" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:${r}px;overflow:hidden;font-family:${FONT};box-shadow:0 2px 10px rgba(20,23,27,.06)">
<tr><td style="background:${head.bg};${head.border}padding:16px 28px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td align="left" style="vertical-align:middle">${logo ? `<img src="${esc(logo)}" alt="${esc(b.name)}" height="44" style="display:block;height:44px;width:auto;border:0;${theme.header === "light" ? "" : "background:#ffffff;border-radius:8px;padding:4px 8px;"}">` : `<span style="font-family:${FONT};font-size:20px;font-weight:800;color:${head.fg}">${esc(b.name)}</span>`}</td>
${tel ? `<td align="right" style="vertical-align:middle"><a href="tel:${esc(tel)}" style="font-family:${FONT};font-size:14px;font-weight:700;color:${head.fg};text-decoration:none">${esc(b.phone)}</a></td>` : ""}
</tr></table></td></tr>
${parts.join("\n")}
<tr><td style="height:18px;font-size:0;line-height:0">&nbsp;</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;font-family:${FONT}">
<tr><td align="center" style="padding:22px 20px 8px;font-size:12px;line-height:1.7;color:${MUTED}">
${socials ? `<div style="margin-bottom:8px;font-size:13px">${socials}</div>` : ""}
<b style="color:${INK}">${esc(b.name)}</b>${str(b.address) ? ` &middot; ${esc(b.address)}` : ""}${site ? `<br><a href="${esc(site)}" style="color:${MUTED}">${esc(site.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a>` : ""}<br>
You're getting this because you're a customer or signed up for our emails.<br>
<a href="{unsubscribe_url}" style="color:${MUTED}">Unsubscribe</a>
</td></tr></table>
</td></tr></table>
</body></html>`;

  const text = [
    ...blocks.map((k) => {
      switch (k.type) {
        case "hero":
          return [k.headline, ...paragraphs(k.text), safeUrl(k.url) && str(k.buttonLabel) ? `${k.buttonLabel}: ${safeUrl(k.url)}` : ""].filter(Boolean).join("\n\n");
        case "text":
          return [k.title, ...paragraphs(k.text)].filter(Boolean).join("\n\n");
        case "coupon":
          return str(k.off) ? `${str(k.off).toUpperCase()}${str(k.line) ? ` — ${k.line}` : ""}${str(k.code) ? `\nCode: ${k.code}` : ""}${str(k.endsAt) ? `\nEnds ${k.endsAt}` : ""}${str(k.note) ? `\n${k.note}` : ""}` : "";
        case "services":
          return (k.items || []).map((x) => `${x.name}${x.from != null ? ` (from $${Number(x.from).toFixed(2)})` : ""}${safeUrl(x.url) ? `: ${safeUrl(x.url)}` : ""}`).join("\n");
        case "split":
          return [k.title, ...paragraphs(k.text), safeUrl(k.url) && str(k.buttonLabel) ? `${k.buttonLabel}: ${safeUrl(k.url)}` : ""].filter(Boolean).join("\n\n");
        case "review":
          return str(k.quote) ? `"${k.quote}"${str(k.name) ? ` — ${k.name}` : ""}` : "";
        case "button":
          return safeUrl(k.url) && str(k.label) ? `${k.label}: ${safeUrl(k.url)}` : "";
        case "visit":
          return [k.title || "Come see us", k.address, b.phone, ...(k.hours || []).map((h) => `${h.days}: ${h.text}`), safeUrl(k.dirUrl) ? `Directions: ${safeUrl(k.dirUrl)}` : ""].filter(Boolean).join("\n");
        default:
          return "";
      }
    }),
    `— ${str(b.name)}${str(b.phone) ? `\n${str(b.phone)}` : ""}`,
    `${[b.name, b.address].map(str).filter(Boolean).join(" · ")}\nUnsubscribe: {unsubscribe_url}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { html, text };
}

/* Fill the placeholders for one person (the server does this at send time;
   the desk uses it for previews). Values are escaped for the HTML copy. */
export function fillPlaceholders(s, vars, { html = true } = {}) {
  return String(s).replace(/\{(first_name|vehicle|due_date|unsubscribe_url)\}/g, (_, k) => {
    let v = str(vars && vars[k]);
    if (k === "first_name" && !v) v = "there";
    return html ? esc(v) : v;
  });
}
