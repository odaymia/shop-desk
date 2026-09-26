import { useState, useEffect, useMemo } from "react";
import { cloud } from "../storage/index.js";
import { Field, Text, Modal, fmtDate } from "./ui.jsx";
import { duePostcards, renderPostcard, mailOf, DEFAULT_STEPS, STEP_LABELS, PHOTO_LIBRARY, photoOf, OIL_TYPES, couponIdsFor } from "../lib/postcards.js";
import { photoUrl } from "../lib/serviceContent.js";
import { couponText } from "../lib/website.js";
import { emailOpts } from "./emailRunner.js";

/* Postcards: oil change reminder cards, mailed by Lob through the "mail"
   Edge Function. The owner approves each week's batch before anything is
   mailed; the desk shows who, where, and what it costs first. */

const OIL_NAME = { ...Object.fromEntries(OIL_TYPES), own: "Their own oil", "": "Not sure" };
const OIL_SETS = [...OIL_TYPES, ["", "Everyone else (their own oil, or not sure)"]];
const money = (n) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
const fillCard = (html, vars) => html.replace(/\{(first_name|vehicle|due_date)\}/g, (_, k) => vars[k] || "");

async function errText(e) {
  try {
    const body = e && e.context && typeof e.context.json === "function" ? await e.context.json() : null;
    if (body && body.error) return body.error;
  } catch {
    /* not JSON */
  }
  return (e && e.message) || "Something went wrong";
}

/* Shrink an uploaded photo to print size (a 6x4 card at 300 dpi is 1875px wide) */
function shrinkPhoto(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1900 / img.width);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't read that photo"))), "image/jpeg", 0.85);
    };
    img.onerror = () => rej(new Error("That file isn't a photo the browser can read."));
    img.src = url;
  });
}

/* a 6.25" x 4.25" card drawn at 96px an inch, scaled to fit */
function CardPreview({ html, label }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ width: 420, height: 286, overflow: "hidden", border: "1px solid var(--line)", borderRadius: 8, background: "#fff" }}>
        <iframe title={label} srcDoc={html} sandbox="" style={{ width: 600, height: 408, border: 0, transform: "scale(.7)", transformOrigin: "0 0" }} />
      </div>
    </div>
  );
}

export function Postcards({ shop, cfg, saveCfg, flash }) {
  const [m, setM] = useState(() => mailOf(cfg));
  useEffect(() => setM(mailOf(cfg)), [cfg]);
  const [mailed, setMailed] = useState(null);
  const [sends, setSends] = useState([]);
  const [status, setStatus] = useState(null);
  const [err, setErr] = useState("");
  const [skip, setSkip] = useState(new Set());
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [view, setView] = useState(0); // which card in the series the preview shows
  const [viewOil, setViewOil] = useState("synthetic"); // and for which oil
  const [uploading, setUploading] = useState(false);
  const [proofOut, setProofOut] = useState(null); // { url } or { error }: stays on the page, unlike a flash

  const load = () => {
    cloud
      .listMailKeys()
      .then((k) => {
        setMailed(new Set(k));
        setErr("");
      })
      .catch((e) => {
        setMailed(new Set());
        setErr(e.message);
      });
    cloud.listMailSends().then(setSends);
    cloud
      .invoke("mail", { action: "status" })
      .then(setStatus)
      .catch(() => setStatus(null));
  };
  useEffect(load, []);

  const cfgNow = { ...cfg, mail: m };
  const batch = useMemo(() => (mailed ? duePostcards({ cfg: cfgNow, customers: shop.customers, vehicles: shop.vehicles, orders: shop.orders, mailed }) : []), [mailed, shop.customers, shop.vehicles, shop.orders, m.aheadDays, m.steps, cfg.reminderMonths]); // eslint-disable-line react-hooks/exhaustive-deps
  const skipKey = (b) => `${b.customerId}|${b.step}`;
  const chosen = batch.filter((b) => !skip.has(skipKey(b)));
  /* one design per card in the series and per oil type (they differ only in coupons) */
  const design = useMemo(() => {
    const cache = {};
    return (k, oil) => (cache[`${k}|${oil}`] = cache[`${k}|${oil}`] || renderPostcard(cfgNow, shop.coupons, emailOpts(), k, oil));
  }, [cfg, m, shop.coupons]); // eslint-disable-line react-hooks/exhaustive-deps
  const card = design(view, viewOil);
  /* "own oil" and "not sure" share the Everyone else coupons */
  const oilSet = (b) => (OIL_TYPES.some(([t]) => t === b.oil) ? b.oil : "");
  const firstOf = (k, oil) => chosen.find((b) => b.step === k && oilSet(b) === oil) || chosen.find((b) => b.step === k);
  const sample = (firstOf(view, viewOil) || batch[0] || {}).vars || { first_name: "Maria", vehicle: "2018 Honda Civic", due_date: "October 12" };
  const counts = [0, 1, 2].map((k) => chosen.filter((b) => b.step === k).length);
  const cost = chosen.length * (Number(m.costPerCard) || 0);

  const setOilSet = (k, oil, ids) => (oil ? setStep(k, { byOil: { ...m.steps[k].byOil, [oil]: ids } }) : setStep(k, { couponIds: ids }));
  const setStep = (k, patch) => setM({ ...m, steps: m.steps.map((st, i) => (i === k ? { ...st, ...patch } : st)) });
  const toggleCoupon = (k, oil, id) => {
    const cur = oil ? m.steps[k].byOil[oil] || [] : m.steps[k].couponIds || [];
    setOilSet(k, oil, cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(0, 3));
  };
  const upload = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    setUploading(true);
    try {
      const url = await cloud.uploadPublicImage(await shrinkPhoto(f), "postcards");
      setM({ ...m, photo: url });
      flash("Photo added. Save to use it on your cards.");
    } catch (err) {
      flash(err.message, "out");
    } finally {
      setUploading(false);
    }
  };
  const saveSettings = async () => {
    const { headline, message, couponId, ...rest } = m; // eslint-disable-line no-unused-vars
    await saveCfg({ ...cfg, mail: { ...rest, aheadDays: Math.max(3, Math.floor(Number(m.aheadDays) || 12)), costPerCard: Number(m.costPerCard) || 0, steps: m.steps.map((st) => ({ ...st, afterDays: Math.max(0, Math.floor(Number(st.afterDays) || 0)) })) } });
    flash("Postcard settings saved");
    setEditing(false);
  };
  const proof = async () => {
    setBusy("proof");
    try {
      const first = firstOf(view, viewOil);
      setProofOut(null);
      const out = await cloud.invoke("mail", { action: "proof", front: card.front, back: card.back, card: first ? { to: first.to, vars: first.vars } : undefined });
      /* a link to click, not a tab opened for them: browsers block tabs that
         open seconds after the click */
      setProofOut(out.url ? { url: out.url, label: `${STEP_LABELS[view]} · ${OIL_NAME[viewOil] || "Everyone else"}` } : { error: "Lob made the proof but didn't send a link back. Look under Postcards in your Lob dashboard (test mode)." });
    } catch (e) {
      setProofOut({ error: await errText(e) });
    } finally {
      setBusy("");
    }
  };
  const mailThem = async () => {
    setConfirm(false);
    setBusy("send");
    const batchId = new Date().toISOString().slice(0, 10);
    let mailedN = 0;
    let already = 0;
    const failed = [];
    try {
      /* each card in the series has its own design, so mail them step by step */
      const groups = new Map();
      for (const b of chosen) {
        const oil = oilSet(b);
        const g = `${b.step}|${couponIdsFor(m.steps[b.step], oil).join(",")}`;
        if (!groups.has(g)) groups.set(g, { d: design(b.step, oil), list: [] });
        groups.get(g).list.push(b);
      }
      for (const { d, list } of groups.values()) {
        for (let i = 0; i < list.length; i += 25) {
          const out = await cloud.invoke("mail", { action: "send", batchId, front: d.front, back: d.back, cards: list.slice(i, i + 25).map((b) => ({ to: b.to, vars: b.vars, dedupe: b.dedupe, customerId: b.customerId })) });
          mailedN += out.mailed || 0;
          already += out.already || 0;
          failed.push(...(out.failed || []));
        }
      }
      flash(`${mailedN} postcard${mailedN === 1 ? "" : "s"} on the way${already ? ` · ${already} had already been mailed` : ""}${failed.length ? ` · ${failed.length} couldn't be mailed (see below)` : ""}`, failed.length ? "out" : undefined);
    } catch (e) {
      flash(await errText(e), "out");
    } finally {
      setBusy("");
      setSkip(new Set());
      load();
    }
  };
  const neverMail = async (b) => {
    const c = shop.customers[b.customerId];
    if (!c) return;
    await shop.saveCustomer({ ...c, mailOptOut: true });
    flash(`${b.to.name} won't get postcards`);
  };

  return (
    <div className="deskBody">
      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        {status ? (
          <span>
            <b style={{ color: status.hasLive ? "var(--green, #1f8a4c)" : "#b42318" }}>{status.hasLive ? "Ready to mail" : status.hasTest ? "Test mode only (proofs, nothing mailed)" : "Lob isn't connected"}</b>
            <span className="muted">
              {" "}
              · {status.mailedThisMonth} mailed this month
              {status.from ? ` · Return address: ${status.from.address_line1}, ${status.from.address_city}` : " · Add your city, state, ZIP in Settings → Website"}
            </span>
          </span>
        ) : (
          <span className="muted">Postcards need the mail function and a Lob account. See "How to set it up" below.</span>
        )}
      </div>
      {err && <p className="legalNote" style={{ color: "#b42318" }}>{err}</p>}

      <div className="seg" style={{ marginBottom: 10 }}>
        {STEP_LABELS.map((l, k) => (
          <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)} disabled={k > 0 && !m.steps[k].on}>
            {l}
            {k > 0 && !m.steps[k].on ? " (off)" : ""}
          </button>
        ))}
      </div>
      <div className="seg" style={{ marginBottom: 10 }}>
        {OIL_SETS.map(([k, l]) => (
          <button key={k || "other"} className={viewOil === k ? "on" : ""} onClick={() => setViewOil(k)}>
            {k ? l : "Everyone else"}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
        <CardPreview html={fillCard(card.front, sample)} label="Front" />
        <CardPreview html={fillCard(card.back, sample).replace("</body>", '<div style="position:absolute;right:.275in;bottom:.25in;width:3.28in;height:2.375in;border:2px dashed #ccc;font:12px sans-serif;color:#999;padding:6px">Address and postage go here</div></body>')} label="Back" />
      </div>
      <div className="rowBtns" style={{ marginBottom: 18 }}>
        <button className="btn" onClick={() => setEditing(!editing)}>
          {editing ? "Close" : "Edit the card"}
        </button>
      </div>
      {editing && (
        <div className="card" style={{ padding: 16, marginBottom: 18 }}>
          <h3 className="subhead" style={{ marginTop: 0 }}>
            Background photo (front)
          </h3>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {PHOTO_LIBRARY.map((p) => (
              <button
                key={p.id}
                type="button"
                title={p.label}
                onClick={() => setM({ ...m, photo: p.id })}
                style={{ padding: 0, border: photoOf(m) === photoUrl(p.id, 1400) ? "3px solid var(--accent, #d9a400)" : "3px solid transparent", borderRadius: 8, background: "none", cursor: "pointer" }}
              >
                <img src={photoUrl(p.id, 240)} alt={p.label} style={{ width: 120, height: 80, objectFit: "cover", borderRadius: 5, display: "block" }} />
              </button>
            ))}
            {/^https:\/\//.test(m.photo || "") && (
              <img src={m.photo} alt="Your photo" style={{ width: 120, height: 80, objectFit: "cover", borderRadius: 8, border: "3px solid var(--accent, #d9a400)" }} />
            )}
            <label className="btn">
              {uploading ? "Uploading…" : "Upload your own photo"}
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={upload} disabled={uploading} />
            </label>
          </div>
          <p className="legalNote">A wide photo works best. Your storefront or bays make the card feel like yours.</p>

          <h3 className="subhead" style={{ marginTop: 22 }}>
            The cards
          </h3>
          {m.steps.map((st, k) => (
            <div key={k} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 14, marginBottom: 12 }}>
              <div className="rowBtns" style={{ alignItems: "center", justifyContent: "space-between" }}>
                <b>{STEP_LABELS[k]}</b>
                {k > 0 ? (
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600 }}>
                    <input type="checkbox" checked={!!st.on} onChange={(e) => setStep(k, { on: e.target.checked })} />
                    {st.on ? "On" : "Off"}
                  </label>
                ) : (
                  <span className="muted">Always on</span>
                )}
              </div>
              {k === 0 ? (
                <Field label="Mail it for sticker dates up to this many days out">
                  <input type="number" min={3} max={30} value={m.aheadDays} onChange={(e) => setM({ ...m, aheadDays: e.target.value })} />
                </Field>
              ) : (
                <Field label={`If the car still hasn't been back, mail it this many days after the sticker date`}>
                  <input type="number" min={7} max={120} value={st.afterDays} onChange={(e) => setStep(k, { afterDays: e.target.value })} />
                </Field>
              )}
              <Field label="Headline (front)">
                <Text value={st.headline} onChange={(v) => setStep(k, { headline: v })} maxLength={40} />
              </Field>
              <Field label="Message (back; {first_name}, {vehicle}, {due_date} fill in per card)">
                <textarea rows={3} maxLength={220} value={st.message} onChange={(e) => setStep(k, { message: e.target.value })} />
              </Field>
              <div className="fld">
                <span>Coupons by the oil the car gets (up to 3 each; ★ is the one on the front). A type left empty gets the "Everyone else" coupons.</span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
                  {OIL_SETS.map(([oil, label]) => {
                    const ids = oil ? st.byOil[oil] || [] : st.couponIds || [];
                    return (
                      <div key={oil || "other"} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px" }}>
                        <b style={{ fontSize: 14 }}>{label}</b>
                        {ids.length ? <span className="muted"> · {ids.length} picked</span> : oil ? <span className="muted"> · uses Everyone else</span> : null}
                        <div style={{ maxHeight: 130, overflow: "auto", marginTop: 4 }}>
                          {Object.values(shop.coupons || {})
                            .filter((c) => c && c.active !== false && !c.deleted)
                            .map((c) => (
                              <label key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", margin: "4px 0", fontSize: 14 }}>
                                <input type="checkbox" checked={ids.includes(c.id)} disabled={!ids.includes(c.id) && ids.length >= 3} onChange={() => toggleCoupon(k, oil, c.id)} />
                                <span>
                                  {ids.indexOf(c.id) === 0 ? "★ " : ""}
                                  <b>{c.code}</b> — {c.name || couponText(c)}
                                </span>
                              </label>
                            ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <button className="btn tiny" onClick={() => setStep(k, { headline: DEFAULT_STEPS[k].headline, message: DEFAULT_STEPS[k].message })}>
                Reset the wording
              </button>
            </div>
          ))}
          <Field label="Cost per card (for the estimate)">
            <input type="number" step="0.01" min={0} value={m.costPerCard} onChange={(e) => setM({ ...m, costPerCard: e.target.value })} />
          </Field>
          <button className="btn primary" onClick={saveSettings}>
            Save
          </button>
        </div>
      )}

      <h3 className="subhead">This week's postcards</h3>
      <p className="legalNote" style={{ marginTop: 0 }}>
        1st cards go to customers whose oil change sticker date is between a week ago and {m.aheadDays} days from now;
        2nd and 3rd cards to cars that still haven't been back. Only customers with a full mailing address, and never the
        same card twice. Cards arrive in about 3–5 business days. Untick anyone to skip them this time.
      </p>
      {!status && <p className="legalNote" style={{ color: "#b42318", marginTop: 0 }}>Proofs and mailing are off: the mail function isn't answering. Check it's deployed in Supabase as "mail".</p>}
      {status && !status.hasTest && <p className="legalNote" style={{ color: "#b42318", marginTop: 0 }}>Proofs are off: add your Lob secret test key as LOB_TEST_KEY in Supabase → Edge Functions → Secrets.</p>}
      {status && !status.from && <p className="legalNote" style={{ color: "#b42318", marginTop: 0 }}>Add your city, state and ZIP in Settings → Website so the cards have a return address.</p>}
      {proofOut && (
        <div className="card" style={{ padding: 12, marginBottom: 10, borderColor: proofOut.error ? "#b42318" : undefined }}>
          {proofOut.error ? (
            <span style={{ color: "#b42318" }}>Proof didn't work: {proofOut.error}</span>
          ) : (
            <span style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <b>Proof ready ({proofOut.label}).</b> Nothing was printed or mailed.
              <a className="btn primary" href={proofOut.url} target="_blank" rel="noreferrer">
                Open the proof (PDF)
              </a>
              <span className="muted">If it says it can't be found, wait 10 seconds and click again. Lob is still drawing it.</span>
            </span>
          )}
        </div>
      )}
      <div className="rowBtns" style={{ alignItems: "center", marginBottom: 10 }}>
        <button className="btn" disabled={!!busy || !status || !status.hasTest} onClick={proof} title="Makes a PDF of the first card with Lob's test key. Nothing is printed or mailed.">
          {busy === "proof" ? "Making proof…" : `Free proof of the ${STEP_LABELS[view]} (PDF)`}
        </button>
        <button className="btn primary" disabled={!!busy || !chosen.length || !status || !status.hasLive} onClick={() => setConfirm(true)}>
          {busy === "send" ? "Mailing…" : `Mail ${chosen.length} postcard${chosen.length === 1 ? "" : "s"} — about ${money(cost)}`}
        </button>
        {chosen.length > 0 && (
          <span className="muted">
            {counts
              .map((n, k) => (n ? `${n} × ${STEP_LABELS[k]}` : ""))
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
      </div>
      <div className="tableCard">
        <table className="dk">
          <thead>
            <tr>
              <th />
              <th>Card</th>
              <th>Customer</th>
              <th>Address</th>
              <th>Car</th>
              <th>Oil</th>
              <th>Sticker date</th>
              <th className="r" />
            </tr>
          </thead>
          <tbody>
            {batch.length === 0 && (
              <tr>
                <td colSpan={8} className="emptyNote">
                  {mailed ? "Nobody's due for a postcard this week." : "Loading…"}
                </td>
              </tr>
            )}
            {batch.map((b) => (
              <tr key={`${b.customerId}|${b.step}`}>
                <td>
                  <input
                    type="checkbox"
                    checked={!skip.has(skipKey(b))}
                    onChange={() => {
                      const n = new Set(skip);
                      if (n.has(skipKey(b))) n.delete(skipKey(b));
                      else n.add(skipKey(b));
                      setSkip(n);
                    }}
                  />
                </td>
                <td>{STEP_LABELS[b.step]}</td>
                <td>{b.to.name}</td>
                <td className="muted">
                  {b.to.address_line1}, {b.to.address_city} {b.to.address_zip}
                </td>
                <td>{b.vars.vehicle}</td>
                <td className="muted">{OIL_NAME[b.oil || ""] || "Not sure"}</td>
                <td>{b.vars.due_date}</td>
                <td className="r">
                  <button className="btn tiny" onClick={() => neverMail(b)}>
                    Never mail
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sends.length > 0 && (
        <>
          <h3 className="subhead" style={{ marginTop: 26 }}>
            Mailed
          </h3>
          <div className="tableCard">
            <table className="dk">
              <thead>
                <tr>
                  <th>Mailed</th>
                  <th>To</th>
                  <th>Status</th>
                  <th>Expected</th>
                </tr>
              </thead>
              <tbody>
                {sends.map((s) => (
                  <tr key={s.id}>
                    <td className="muted">{fmtDate(Date.parse(s.created_at))}</td>
                    <td>
                      {s.name}
                      <div className="sub muted">{s.address ? `${s.address.address_line1}, ${s.address.address_city}` : ""}</div>
                    </td>
                    <td>{s.status === "mailed" ? "Mailed" : <span style={{ color: "#b42318" }}>Not mailed: {s.error}</span>}</td>
                    <td className="muted">{s.expected_delivery || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h3 className="subhead" style={{ marginTop: 26 }}>
        How to set it up (once)
      </h3>
      <ol className="legalNote" style={{ paddingLeft: 20, lineHeight: 1.7 }}>
        <li>Run supabase/mail.sql in the Supabase SQL editor.</li>
        <li>Make a Lob account (lob.com). In Settings → API Keys, copy the Test key and, once you add billing, the Live key.</li>
        <li>Deploy the mail function (supabase/functions/mail) and add its secrets LOB_TEST_KEY and LOB_LIVE_KEY.</li>
        <li>Get a free proof to check the card, then mail your first batch.</li>
      </ol>

      {confirm && (
        <Modal title="Mail these postcards?" onClose={() => setConfirm(false)}>
          <p>
            <b>{chosen.length}</b> postcard{chosen.length === 1 ? "" : "s"}, about <b>{money(cost)}</b> with postage. Lob prints
            and mails them within a day or two.
          </p>
          <p className="muted">Mailed cards can't be called back. Get a free proof first if you haven't.</p>
          <div className="rowBtns">
            <button className="btn primary" onClick={mailThem}>
              Mail {chosen.length} postcard{chosen.length === 1 ? "" : "s"}
            </button>
            <button className="btn" onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
