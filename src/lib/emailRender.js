/* The shop's marketing email, as HTML every mail app draws the same way
   (tables and inline styles; no web fonts, no scripts, no data: images) and
   a plain-text twin. Pure — returns strings.

   Personal bits are left as placeholders the sending server fills in per
   person, so one copy of the email serves the whole list:
     {first_name}        "Ana", or "there" when we don't know it
     {vehicle} {due_date} used by the oil change reminder
     {unsubscribe_url}   a signed link only the server can make
   The shop's own text can use {first_name} too ("Hi {first_name},"). */

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

/* Paragraphs from the owner's text: a blank line starts a new one. */
const paragraphs = (t) =>
  str(t)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

/* brand: { name, logo, color, accent, address, phone, email, website }
   msg:   { preheader, headline, body, coupon: { off, line, code, endsAt }, button: { label, url } } */
export function renderEmail(brand, msg) {
  const b = brand || {};
  const m = msg || {};
  const main = color(b.color, "#8e2f2f");
  const logo = safeUrl(b.logo);
  const btnUrl = safeUrl(m.button && m.button.url);
  const btnLabel = str(m.button && m.button.label);
  const c = m.coupon && str(m.coupon.off) ? m.coupon : null;
  const site = safeUrl(b.website);
  const foot = [b.name, b.address].map(str).filter(Boolean).join(" · ");

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="x-apple-disable-message-reformatting">
<title>${esc(m.subject || b.name)}</title></head>
<body style="margin:0;padding:0;background:#f2efe9;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(m.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2efe9"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#1b1d21">
<tr><td style="background:#121417;padding:18px 24px" align="left">${
    logo
      ? `<img src="${esc(logo)}" alt="${esc(b.name)}" height="48" style="display:block;height:48px;width:auto;border:0;background:#ffffff;border-radius:8px;padding:4px 8px">`
      : `<span style="color:#ffffff;font-size:22px;font-weight:bold">${esc(b.name)}</span>`
  }</td></tr>
<tr><td style="height:6px;background:${main};font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:32px 32px 8px">
${str(m.headline) ? `<h1 style="margin:0 0 18px;font-size:28px;line-height:1.15;color:#1b1d21">${esc(m.headline)}</h1>` : ""}
${paragraphs(m.body)
  .map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#33373d">${esc(p).replace(/\n/g, "<br>")}</p>`)
  .join("\n")}
</td></tr>
${
  c
    ? `<tr><td style="padding:8px 32px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px dashed ${main};border-radius:12px"><tr><td align="center" style="padding:22px 16px">
<div style="font-size:40px;line-height:1;font-weight:bold;color:${main}">${esc(str(c.off).toUpperCase())}</div>
${str(c.line) ? `<div style="margin-top:8px;font-size:15px;font-weight:bold;text-transform:uppercase;color:#1b1d21">${esc(c.line)}</div>` : ""}
${str(c.code) ? `<div style="margin-top:14px"><span style="display:inline-block;background:#121417;color:#ffffff;font-family:'Courier New',monospace;font-size:20px;letter-spacing:3px;padding:8px 16px;border-radius:8px">${esc(c.code)}</span></div>` : ""}
<div style="margin-top:10px;font-size:13px;color:#5b616c">Show this email at the counter.${str(c.endsAt) ? ` Ends ${esc(c.endsAt)}.` : ""}</div>
</td></tr></table></td></tr>`
    : ""
}
${
  btnUrl && btnLabel
    ? `<tr><td align="center" style="padding:18px 32px 8px"><a href="${esc(btnUrl)}" style="display:inline-block;background:${main};color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 28px;border-radius:10px">${esc(btnLabel)}</a></td></tr>`
    : ""
}
<tr><td style="padding:22px 32px 30px;font-size:15px;line-height:1.5;color:#33373d">— ${esc(b.name)}${str(b.phone) ? `<br><a href="tel:${esc(str(b.phone).replace(/[^\d+]/g, ""))}" style="color:${main};text-decoration:none">${esc(b.phone)}</a>` : ""}</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;font-family:Arial,Helvetica,sans-serif">
<tr><td align="center" style="padding:18px 16px 8px;font-size:12px;line-height:1.6;color:#6b7078">
${esc(foot)}${site ? `<br><a href="${esc(site)}" style="color:#6b7078">${esc(site.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a>` : ""}<br>
You're getting this because you're a customer or signed up for our emails.<br>
<a href="{unsubscribe_url}" style="color:#6b7078">Unsubscribe</a>
</td></tr></table>
</td></tr></table>
</body></html>`;

  const text = [
    str(m.headline),
    ...paragraphs(m.body),
    c ? `${str(c.off).toUpperCase()}${str(c.line) ? ` — ${str(c.line)}` : ""}${str(c.code) ? `\nCode: ${str(c.code)}` : ""}${str(c.endsAt) ? `\nEnds ${str(c.endsAt)}` : ""}\nShow this email at the counter.` : "",
    btnUrl && btnLabel ? `${btnLabel}: ${btnUrl}` : "",
    `— ${str(b.name)}${str(b.phone) ? `\n${str(b.phone)}` : ""}`,
    `${foot}\nUnsubscribe: {unsubscribe_url}`,
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
