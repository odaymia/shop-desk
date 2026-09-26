import { useState, useEffect, useMemo } from "react";
import { Field, Text, fmtDate } from "./ui.jsx";
import { cloud } from "../storage/index.js";
import { DEFAULT_WEBSITE, FALLBACK_HIGHLIGHTS, DEFAULT_FAQ, DAY_NAMES, parseHoursText, normalizeHoursWeek, hoursText, slugify, couponText } from "../lib/website.js";
import { renderSite } from "../lib/siteRender.js";
import { offerSlug } from "../lib/website.js";
import { QR } from "./QR.jsx";
import qrcode from "qrcode-generator";

/* Settings → Website. The shop's public site is built from what's already
   in the desk (name, phone, address, service menu, oil packages, published
   prices, the invoice history); this is where the owner adds what only
   they know — the city line, a photo, what to say about the shop, which
   specials to advertise — and watches the page change as they type.
   "Save settings" publishes it. */

const siteUrl = (slug) => new URL(`site/?s=${encodeURIComponent(slug)}`, window.location.href).toString();
const portalUrl = () => new URL("portal/", window.location.href).toString();
/* A coupon's ad landing page: the ?offer= form survives ad platforms that
   strip or mangle #fragments */
const offerUrl = (slug, c) => `${siteUrl(slug)}&offer=${encodeURIComponent(offerSlug(c))}`;

/* Shrink a shop photo to something that fits in the settings record. */
function readPhoto(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1600 / img.width);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = () => rej(new Error("That file isn't an image the browser can read."));
    img.src = url;
  });
}

function download(name, text, type = "text/html") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function WebsiteSettings({ d, set, shop, flash }) {
  const w = { ...DEFAULT_WEBSITE, ...(d.website || {}) };
  const setW = (patch) => set("website")({ ...w, ...patch });
  const slug = w.slug || slugify(d.shopName);
  const week = normalizeHoursWeek(w.hoursWeek || parseHoursText(d.hours));
  const setDay = (i, patch) => {
    const next = week.map((x, k) => (k === i ? { ...x, ...patch } : x));
    setW({ hoursWeek: next });
    set("hours")(hoursText(next)); // keep the portal's free-text hours in step
  };

  /* preview: rebuilt a moment after typing stops */
  const [srcDoc, setSrcDoc] = useState("");
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    if (!shop) return;
    const t = setTimeout(() => {
      try {
        setSrcDoc(renderSite(shop.buildSite({ ...d, website: { ...w, slug } }), { preview: true, portalUrl: d.portalEnabled ? portalUrl() : "" }));
      } catch (e) {
        console.error("website preview", e);
      }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, shop]);

  const [requests, setRequests] = useState([]);
  const loadRequests = () => cloud.listSiteRequests().then(setRequests).catch(() => setRequests([]));
  useEffect(() => {
    loadRequests();
  }, []);

  const coupons = useMemo(
    () =>
      Object.values((shop && shop.coupons) || {})
        .filter((c) => c && c.active !== false && !c.deleted)
        .sort((a, b) => String(a.name || a.code).localeCompare(String(b.name || b.code))),
    [shop]
  );
  const toggleIn = (key, id) => {
    const cur = new Set(w[key] || []);
    if (cur.has(id)) cur.delete(id);
    else cur.add(id);
    setW({ [key]: [...cur] });
  };
  const faq = w.faq && w.faq.length ? w.faq : DEFAULT_FAQ;
  const setFaq = (i, patch) => setW({ faq: faq.map((f, k) => (k === i ? { ...f, ...patch } : f)) });

  return (
    <>
      <h3 className="subhead" style={{ marginTop: 0 }}>
        Your website
      </h3>
      <p className="legalNote" style={{ marginTop: 0 }}>
        A public web page for your shop, built from what's already here: your name, phone, address, service menu, oil
        change prices, and history. Customers can call, get directions, price an oil change for their car, see your
        specials, and ask for an appointment. Change a price or your hours and the site follows when you save.
      </p>
      <Field label="Website">
        <select value={w.enabled ? "on" : "off"} onChange={(e) => setW({ enabled: e.target.value === "on", slug })}>
          <option value="off">Off — not published</option>
          <option value="on">On — published when you save</option>
        </select>
      </Field>
      <Field label="Web address">
        <Text value={w.slug} placeholder={slugify(d.shopName)} onChange={(v) => setW({ slug: v.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} />
      </Field>
      <p className="legalNote" style={{ marginTop: 4 }}>
        {siteUrl(slug)}
      </p>
      <div className="rowBtns" style={{ alignItems: "center" }}>
        <a className="btn" href={siteUrl(slug)} target="_blank" rel="noreferrer">
          Open the website ↗
        </a>
      </div>

      <h3 className="subhead" style={{ marginTop: 28 }}>
        Your own domain
      </h3>
      <p className="legalNote" style={{ marginTop: 0 }}>
        Want the site on your own address, like www.yourshop.com? Bolt Badger connects it for you as part of the website
        add-on: send us your domain and we'll walk you through the one DNS change. Your site stays up to date on its own
        once it's connected.
      </p>
      <Field label="Your domain (once it's connected, emails and links use it)">
        <Text value={w.domain || ""} onChange={(v) => setW({ domain: v.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "") })} placeholder="www.yourshop.com" />
      </Field>

      {requests.length > 0 && (
        <>
          <h3 className="subhead" style={{ marginTop: 28 }}>
            Appointment requests ({requests.length})
          </h3>
          {requests.map((r) => (
            <div key={r.id} className="card" style={{ padding: 12, marginBottom: 8 }}>
              <b>{r.name}</b> · {r.phone || r.email} {r.email && r.phone ? `· ${r.email}` : ""}
              <div>
                {[r.service, r.vehicle, r.preferred_day && `wants ${r.preferred_day}`].filter(Boolean).join(" · ")}
              </div>
              {r.note && <div style={{ color: "var(--muted)" }}>{r.note}</div>}
              <div className="rowBtns" style={{ marginTop: 6, alignItems: "center" }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Sent {fmtDate(new Date(r.created_at).getTime())}</span>
                <button
                  className="btn tiny"
                  onClick={async () => {
                    await cloud.handleSiteRequest(r.id);
                    loadRequests();
                  }}
                >
                  Done — we called them
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      <h3 className="subhead" style={{ marginTop: 28 }}>
        What it says
      </h3>
      <Field label="City, state, ZIP (finishes your address for maps and Google)">
        <Text value={w.cityLine} onChange={(v) => setW({ cityLine: v })} placeholder="San Diego, CA 92101" />
      </Field>
      <Field label="Headline (blank writes one from your services)">
        <Text value={w.tagline} onChange={(v) => setW({ tagline: v })} placeholder="Oil change, brakes & tires, done right." />
      </Field>
      <Field label="About the shop (blank uses a short default)">
        <textarea rows={4} value={w.about} onChange={(e) => setW({ about: e.target.value })} placeholder="Family owned since…" />
      </Field>
      <Field label="Selling points, one per line: Headline — supporting line (blank picks them from your warranty, oil, hours and history)">
        <textarea rows={4} value={(w.highlights || []).join("\n")} onChange={(e) => setW({ highlights: e.target.value.split("\n") })} placeholder={FALLBACK_HIGHLIGHTS.join("\n")} />
      </Field>
      <div className="fld">
        <span>Shop photo (behind the headline)</span>
        <div className="rowBtns">
          {w.heroPhoto && <img src={w.heroPhoto} alt="" style={{ height: 60, borderRadius: 6 }} />}
          <label className="btn tiny">
            Upload
            <input
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={async (e) => {
                const f = e.target.files && e.target.files[0];
                if (!f) return;
                try {
                  setW({ heroPhoto: await readPhoto(f) });
                } catch (err) {
                  flash(err.message, "out");
                }
              }}
            />
          </label>
          {w.heroPhoto && (
            <button className="btn tiny" onClick={() => setW({ heroPhoto: "" })}>
              Remove
            </button>
          )}
        </div>
      </div>
      <div className="fldRow">
        <Field label="Main color">
          <input type="color" value={w.brandColor} onChange={(e) => setW({ brandColor: e.target.value })} />
        </Field>
        <Field label="Link color">
          <input type="color" value={w.accentColor} onChange={(e) => setW({ accentColor: e.target.value })} />
        </Field>
      </div>

      <h3 className="subhead" style={{ marginTop: 28 }}>
        Hours
      </h3>
      <table className="tbl" style={{ maxWidth: 460 }}>
        <tbody>
          {[1, 2, 3, 4, 5, 6, 0].map((i) => (
            <tr key={i}>
              <td>{DAY_NAMES[i]}</td>
              <td>
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" checked={!week[i].closed} onChange={(e) => setDay(i, e.target.checked ? { closed: false, open: week[i].open || "08:00", close: week[i].close || "17:00" } : { closed: true })} />
                  Open
                </label>
              </td>
              <td>{!week[i].closed && <input type="time" value={week[i].open} onChange={(e) => setDay(i, { open: e.target.value })} />}</td>
              <td>{!week[i].closed && <input type="time" value={week[i].close} onChange={(e) => setDay(i, { close: e.target.value })} />}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="subhead" style={{ marginTop: 28 }}>
        What it shows
      </h3>
      {[
        ["showPrices", "Prices: oil change packages and canned jobs ticked \"Show on the customer portal\""],
        ["quoteTool", "Oil change price finder: customers pick their car, see the oil it takes and their price (from your service specs)"],
        ["showStats", "Your history: the year you started and how many services you've done"],
        ["booking", "Appointment request form (requests show up here)"],
        ["signup", "\"Get specials by email\" signup box (signups show up on the Email list page)"],
      ].map(([k, label]) => (
        <label key={k} style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "8px 0" }}>
          <input type="checkbox" checked={!!w[k]} onChange={(e) => setW({ [k]: e.target.checked })} />
          <span>{label}</span>
        </label>
      ))}
      {w.booking && (d.serviceMenu || []).length > 0 && (
        <Field label="First come, first served (no appointments) — these say &quot;just pull in&quot; instead of offering to book">
          <div>
            {(d.serviceMenu || []).map((m) => (
              <label key={m.id} style={{ display: "flex", gap: 8, alignItems: "center", margin: "4px 0" }}>
                <input type="checkbox" checked={(w.walkIn || []).includes(m.id)} onChange={() => toggleIn("walkIn", m.id)} />
                <span>{m.name}</span>
              </label>
            ))}
          </div>
        </Field>
      )}
      {(d.oilPackages || []).length > 0 && (
        <Field label="Oil change packages on the site">
          <div>
            {(d.oilPackages || []).map((p) => (
              <label key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", margin: "4px 0" }}>
                <input type="checkbox" checked={!(w.hiddenPackages || []).includes(p.id)} onChange={() => toggleIn("hiddenPackages", p.id)} />
                <span>
                  {p.name} — ${Number(p.price || 0).toFixed(2)}
                </span>
              </label>
            ))}
          </div>
        </Field>
      )}

      <h3 className="subhead" style={{ marginTop: 28 }}>
        Specials to advertise
      </h3>
      <p className="legalNote" style={{ marginTop: 0 }}>
        None are shown until you tick them, so manager-only codes stay private. Expired ones drop off by themselves.
      </p>
      <div style={{ maxHeight: 240, overflow: "auto", border: "1px solid var(--line)", borderRadius: 8, padding: "4px 10px" }}>
        {coupons.length === 0 && <p className="legalNote">No coupons yet. Make them under Coupons.</p>}
        {coupons.map((c) => (
          <label key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", margin: "6px 0" }}>
            <input type="checkbox" checked={(w.couponIds || []).includes(c.id)} onChange={() => toggleIn("couponIds", c.id)} />
            <span>
              <b>{c.code}</b> — {c.name || couponText(c)}
              {c.endsAt ? ` (ends ${c.endsAt})` : ""}
            </span>
          </label>
        ))}
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "10px 0" }}>
        <input type="checkbox" checked={!!w.couponCodes} onChange={(e) => setW({ couponCodes: e.target.checked })} />
        <span>Print the coupon code on the site</span>
      </label>

      <h3 className="subhead" style={{ marginTop: 28 }}>
        Ad landing pages
      </h3>
      <p className="legalNote" style={{ marginTop: 0 }}>
        Give a coupon its own page to send people to from an ad, a flyer, or a text blast: the coupon front and center,
        why to choose you, and a short form to claim it. Requests come in tagged with the code, so you can tell which ad
        worked. A coupon doesn't have to be one of the specials above to get a page. Save settings to publish.
      </p>
      <div style={{ maxHeight: 240, overflow: "auto", border: "1px solid var(--line)", borderRadius: 8, padding: "4px 10px" }}>
        {coupons.length === 0 && <p className="legalNote">No coupons yet. Make one under Coupons, then give it a page here.</p>}
        {coupons.map((c) => (
          <label key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", margin: "6px 0" }}>
            <input
              type="checkbox"
              checked={!!(w.offers || {})[c.id]}
              onChange={(e) => {
                const next = { ...(w.offers || {}) };
                if (e.target.checked) next[c.id] = { headline: "", blurb: "" };
                else delete next[c.id];
                setW({ offers: next });
              }}
            />
            <span>
              <b>{c.code}</b> — {c.name || couponText(c)}
              {c.endsAt ? ` (ends ${c.endsAt})` : ""}
            </span>
          </label>
        ))}
      </div>
      {coupons
        .filter((c) => (w.offers || {})[c.id])
        .map((c) => {
          const o = w.offers[c.id];
          const url = offerUrl(slug, c);
          const setO = (patch) => setW({ offers: { ...w.offers, [c.id]: { ...o, ...patch } } });
          return (
            <div key={c.id} className="card" style={{ padding: 14, marginTop: 12, display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
              <QR value={url} size={132} />
              <div style={{ flex: 1, minWidth: 260 }}>
                <b>
                  {c.code} — {c.name || couponText(c)}
                </b>
                <div style={{ fontSize: 13, wordBreak: "break-all", margin: "4px 0 8px", color: "var(--muted)" }}>{url}</div>
                <div className="rowBtns" style={{ marginBottom: 8 }}>
                  <button
                    className="btn tiny"
                    onClick={() =>
                      navigator.clipboard.writeText(url).then(
                        () => flash("Link copied"),
                        () => flash("Couldn't copy. Select the link and copy it.", "out")
                      )
                    }
                  >
                    Copy link
                  </button>
                  <a className="btn tiny" href={url} target="_blank" rel="noreferrer">
                    Open ↗
                  </a>
                  <button
                    className="btn tiny"
                    title="A sharp QR code for flyers, receipts, and signs — it scales to any size"
                    onClick={() => {
                      const qr = qrcode(0, "M");
                      qr.addData(url);
                      qr.make();
                      download(`${offerSlug(c)}-qr.svg`, qr.createSvgTag({ scalable: true, margin: 2 }), "image/svg+xml");
                    }}
                  >
                    Download QR
                  </button>
                </div>
                <Field label="Headline (blank uses the coupon: $20 OFF ANY OIL CHANGE)">
                  <Text value={o.headline} onChange={(v) => setO({ headline: v })} placeholder="New here? Your first oil change is $20 off" />
                </Field>
                <Field label="Line under it (blank says where to bring it)">
                  <Text value={o.blurb} onChange={(v) => setO({ blurb: v })} placeholder="Show this coupon at the counter. No appointment needed." />
                </Field>
                {!c.endsAt && <p className="legalNote" style={{ margin: "4px 0 0" }}>Tip: give the coupon an end date under Coupons. The page shows a countdown, and it comes down by itself when it ends.</p>}
              </div>
            </div>
          );
        })}

      <h3 className="subhead" style={{ marginTop: 28 }}>
        Questions and answers
      </h3>
      {faq.map((f, i) => (
        <div key={i} className="fldRow" style={{ alignItems: "flex-end" }}>
          <Field label={i === 0 ? "Question" : ""}>
            <Text value={f.q} onChange={(v) => setFaq(i, { q: v })} />
          </Field>
          <Field label={i === 0 ? "Answer" : ""}>
            <Text value={f.a} onChange={(v) => setFaq(i, { a: v })} />
          </Field>
          <button className="btn tiny" onClick={() => setW({ faq: faq.filter((_, k) => k !== i) })}>
            Remove
          </button>
        </div>
      ))}
      <button className="btn tiny" style={{ marginTop: 8 }} onClick={() => setW({ faq: [...faq, { q: "", a: "" }] })}>
        + Add a question
      </button>

      <h3 className="subhead" style={{ marginTop: 28 }}>
        Review and social pages
      </h3>
      <div className="fldRow">
        {["google", "yelp", "facebook", "instagram"].map((k) => (
          <Field key={k} label={k[0].toUpperCase() + k.slice(1)}>
            <Text value={(w.links || {})[k] || ""} onChange={(v) => setW({ links: { ...(w.links || {}), [k]: v } })} placeholder="https://…" />
          </Field>
        ))}
      </div>

      <h3 className="subhead" style={{ marginTop: 28 }}>
        Preview
      </h3>
      <div className="rowBtns" style={{ marginBottom: 8 }}>
        <button className={`btn tiny ${!phone ? "primary" : ""}`} onClick={() => setPhone(false)}>
          Computer
        </button>
        <button className={`btn tiny ${phone ? "primary" : ""}`} onClick={() => setPhone(true)}>
          Phone
        </button>
      </div>
      <iframe
        title="Website preview"
        srcDoc={srcDoc}
        sandbox="allow-scripts allow-popups"
        style={{ width: phone ? 390 : "100%", height: 720, border: "1px solid var(--line)", borderRadius: 10, background: "#fff" }}
      />
    </>
  );
}
