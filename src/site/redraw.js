/* Draw a freshly rendered page over the one on screen, in place.

   The page on a shop's own domain is a snapshot; when the shop has published
   since, the newer page is drawn over it. This used to be document.open() +
   document.write(), which throws the whole document away and rebuilds it.
   Some in-app browsers (Instagram's on iPhone) came back from that with the
   new page's CSS never applied: default fonts, icons with no size. So the
   document is never reopened. The page that is already working stays, and
   its parts are swapped: the page's own <style>, the head tags, and the
   body. The new style goes in before the old one comes out, so there is no
   moment without one.

   Scripts are run by hand, in order, because a script that arrives by DOM
   insertion doesn't run on its own:
   - in <head> (analytics tags): only ones that haven't already run here, so
     an unchanged tag doesn't count the visit twice
   - in <body> (the tire widget, the page's data, the page's script): always,
     since they belong to elements that were just replaced. The page's own
     script undoes its previous run first (window.__sbOff, siteRender.js). */

const abs = (u) => {
  try {
    return new URL(u, location.href).href;
  } catch {
    return String(u || "");
  }
};
const keyOf = (s) => (s.getAttribute("src") ? "src:" + abs(s.getAttribute("src")) : "txt:" + s.textContent);
const typeOf = (s) => String(s.getAttribute("type") || "").trim().toLowerCase();
const isData = (s) => typeOf(s) === "application/ld+json";
/* head tags this page owns and may replace; anything else up there was put in
   by a widget or a tag and is left alone */
const KEEP_META = new Set(["viewport", "bolt-badger-site"]);
const metaName = (m) => String(m.getAttribute("name") || m.getAttribute("property") || "").toLowerCase();
const OWN_LINK = new Set(["icon", "canonical"]);

/* Insert a script so that it runs; resolves when an external one has loaded
   (or failed, or 8s have passed), so the next can rely on it. */
function run(src, place) {
  return new Promise((done) => {
    const el = document.createElement("script");
    for (const a of src.attributes) el.setAttribute(a.name, a.value);
    const external = !!src.getAttribute("src");
    const waits = external && !src.hasAttribute("async") && !src.hasAttribute("defer");
    if (!external) el.textContent = src.textContent;
    if (waits) {
      el.async = false;
      el.onload = el.onerror = () => done();
      setTimeout(done, 8000);
    }
    try {
      place(el);
    } catch {
      /* a script that won't insert must not stop the page */
    }
    if (!waits) done();
  });
}

/* `html` is a whole rendered page. `appSrc` is this script's own address: its
   tag is dropped from the new body, since it is already running. */
export async function redraw(html, { appSrc = "" } = {}) {
  const next = new DOMParser().parseFromString(String(html || ""), "text/html");
  /* nothing of the site has run yet: this is the bare loading page, and all
     of its styling goes */
  const firstDraw = !window.SITE;
  const ran = new Set([...document.scripts].map(keyOf));
  const y = window.scrollY || 0;
  /* <noscript> is for browsers without scripts. Parsed here its contents are
     real elements, and an analytics pixel inside would load and count a visit */
  next.querySelectorAll("noscript").forEach((n) => n.remove());

  /* the previous page's script lets go of the document and window */
  try {
    if (typeof window.__sbOff === "function") window.__sbOff();
  } catch {
    /* ignore */
  }

  // ---- head
  const head = document.head;
  document.documentElement.lang = next.documentElement.lang || document.documentElement.lang || "en";
  document.title = next.title || document.title;
  for (const m of [...head.querySelectorAll("meta[name],meta[property]")]) if (!KEEP_META.has(metaName(m))) m.remove();
  for (const m of [...next.head.querySelectorAll("meta[name],meta[property]")]) {
    if (KEEP_META.has(metaName(m)) && head.querySelector(`meta[name="${metaName(m)}"]`)) continue;
    head.appendChild(document.adoptNode(m));
  }
  const linkSig = (l) => `${String(l.getAttribute("rel") || "").toLowerCase()}|${abs(l.getAttribute("href"))}`;
  const wanted = new Set([...next.head.querySelectorAll("link")].map(linkSig));
  const have = new Set();
  for (const l of [...head.querySelectorAll("link")]) {
    if (OWN_LINK.has(String(l.getAttribute("rel") || "").toLowerCase()) && !wanted.has(linkSig(l))) l.remove();
    else have.add(linkSig(l));
  }
  for (const l of [...next.head.querySelectorAll("link")]) if (!have.has(linkSig(l))) head.appendChild(document.adoptNode(l));
  const oldLd = [...head.querySelectorAll("script")].filter(isData);
  for (const s of [...next.head.querySelectorAll("script")].filter(isData)) head.appendChild(document.adoptNode(s));
  oldLd.forEach((s) => s.remove());
  /* the stylesheet: new in, then old out */
  const ours = (s) => firstDraw || s.hasAttribute("data-sb") || /^\s*:root\{--brand:/.test(s.textContent);
  const oldStyles = [...head.querySelectorAll("style")].filter(ours);
  for (const s of [...next.head.querySelectorAll("style")]) {
    const el = document.createElement("style");
    for (const a of s.attributes) el.setAttribute(a.name, a.value);
    el.textContent = s.textContent;
    head.appendChild(el);
  }
  oldStyles.forEach((s) => s.remove());
  for (const s of [...next.head.querySelectorAll("script")]) {
    if (isData(s) || ran.has(keyOf(s))) continue;
    await run(s, (el) => head.appendChild(el));
  }

  // ---- body
  const todo = [];
  for (const s of [...next.body.querySelectorAll("script")]) {
    if (isData(s)) continue;
    const src = s.getAttribute("src");
    if (appSrc && src && abs(src) === abs(appSrc)) {
      s.remove();
      continue;
    }
    const mark = next.createComment("script");
    s.replaceWith(mark);
    todo.push([mark, s]);
  }
  const body = document.body;
  for (const a of [...body.attributes]) body.removeAttribute(a.name);
  for (const a of [...next.body.attributes]) body.setAttribute(a.name, a.value);
  const frag = document.createDocumentFragment();
  for (const n of [...next.body.childNodes]) frag.appendChild(document.adoptNode(n));
  body.replaceChildren(frag);
  for (const [mark, s] of todo) await run(s, (el) => mark.replaceWith(el));
  if (y && !location.hash) window.scrollTo(0, y);
}
