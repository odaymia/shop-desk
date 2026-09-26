import { useState, useEffect, useMemo } from "react";
import { cloud } from "../storage/index.js";
import { Field, Text, Modal, fmtDate } from "./ui.jsx";
import { duePostcards, renderPostcard, mailOf, DEFAULT_MAIL } from "../lib/postcards.js";
import { couponText } from "../lib/website.js";
import { emailOpts } from "./emailRunner.js";

/* Postcards: oil change reminder cards, mailed by Lob through the "mail"
   Edge Function. The owner approves each week's batch before anything is
   mailed; the desk shows who, where, and what it costs first. */

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
  const batch = useMemo(() => (mailed ? duePostcards({ cfg: cfgNow, customers: shop.customers, vehicles: shop.vehicles, orders: shop.orders, mailed }) : []), [mailed, shop.customers, shop.vehicles, shop.orders, m.aheadDays, cfg.reminderMonths]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = batch.filter((b) => !skip.has(b.customerId));
  const card = useMemo(() => renderPostcard(cfgNow, shop.coupons, emailOpts()), [cfg, m, shop.coupons]); // eslint-disable-line react-hooks/exhaustive-deps
  const sample = batch[0] ? batch[0].vars : { first_name: "Maria", vehicle: "2018 Honda Civic", due_date: "October 12" };
  const cost = chosen.length * (Number(m.costPerCard) || 0);

  const saveSettings = async () => {
    await saveCfg({ ...cfg, mail: { ...m, aheadDays: Math.max(3, Math.floor(Number(m.aheadDays) || 12)), costPerCard: Number(m.costPerCard) || 0 } });
    flash("Postcard settings saved");
    setEditing(false);
  };
  const proof = async () => {
    setBusy("proof");
    try {
      const first = chosen[0];
      const out = await cloud.invoke("mail", { action: "proof", front: card.front, back: card.back, card: first ? { to: first.to, vars: first.vars } : undefined });
      if (out.url) window.open(out.url, "_blank", "noopener");
      flash("Proof made. Lob's PDF opens in a new tab (it can take a few seconds to be ready). Nothing was mailed.");
    } catch (e) {
      flash(await errText(e), "out");
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
      for (let i = 0; i < chosen.length; i += 25) {
        const out = await cloud.invoke("mail", { action: "send", batchId, front: card.front, back: card.back, cards: chosen.slice(i, i + 25).map((b) => ({ to: b.to, vars: b.vars, dedupe: b.dedupe, customerId: b.customerId })) });
        mailedN += out.mailed || 0;
        already += out.already || 0;
        failed.push(...(out.failed || []));
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
        <div className="card" style={{ padding: 16, marginBottom: 18, maxWidth: 720 }}>
          <Field label="Headline (front)">
            <Text value={m.headline} onChange={(v) => setM({ ...m, headline: v })} maxLength={40} />
          </Field>
          <Field label="Message (back; {first_name}, {vehicle}, {due_date} fill in per card)">
            <textarea rows={3} maxLength={260} value={m.message} onChange={(e) => setM({ ...m, message: e.target.value })} />
          </Field>
          <Field label="Coupon (the QR code opens its page when it has one)">
            <select value={m.couponId || ""} onChange={(e) => setM({ ...m, couponId: e.target.value })}>
              <option value="">No coupon</option>
              {Object.values(shop.coupons || {})
                .filter((c) => c && c.active !== false && !c.deleted)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name || couponText(c)}
                    {c.endsAt ? ` (ends ${c.endsAt})` : ""}
                  </option>
                ))}
            </select>
          </Field>
          <div className="fldRow">
            <Field label="Mail cards for sticker dates up to (days out)">
              <input type="number" min={3} max={30} value={m.aheadDays} onChange={(e) => setM({ ...m, aheadDays: e.target.value })} />
            </Field>
            <Field label="Cost per card (for the estimate)">
              <input type="number" step="0.01" min={0} value={m.costPerCard} onChange={(e) => setM({ ...m, costPerCard: e.target.value })} />
            </Field>
          </div>
          <div className="rowBtns">
            <button className="btn primary" onClick={saveSettings}>
              Save
            </button>
            <button className="btn" onClick={() => setM({ ...DEFAULT_MAIL, couponId: m.couponId })}>
              Reset the wording
            </button>
          </div>
        </div>
      )}

      <h3 className="subhead">This week's postcards</h3>
      <p className="legalNote" style={{ marginTop: 0 }}>
        Customers whose oil change sticker date is between a week ago and {m.aheadDays} days from now, with a full mailing
        address, who haven't been mailed this reminder. Cards arrive in about 3–5 business days. Untick anyone to skip them
        this time.
      </p>
      <div className="rowBtns" style={{ alignItems: "center", marginBottom: 10 }}>
        <button className="btn" disabled={!!busy || !status || !status.hasTest} onClick={proof} title="Makes a PDF of the first card with Lob's test key. Nothing is printed or mailed.">
          {busy === "proof" ? "Making proof…" : "Get a free proof (PDF)"}
        </button>
        <button className="btn primary" disabled={!!busy || !chosen.length || !status || !status.hasLive} onClick={() => setConfirm(true)}>
          {busy === "send" ? "Mailing…" : `Mail ${chosen.length} postcard${chosen.length === 1 ? "" : "s"} — about ${money(cost)}`}
        </button>
      </div>
      <div className="tableCard">
        <table className="dk">
          <thead>
            <tr>
              <th />
              <th>Customer</th>
              <th>Address</th>
              <th>Car</th>
              <th>Sticker date</th>
              <th className="r" />
            </tr>
          </thead>
          <tbody>
            {batch.length === 0 && (
              <tr>
                <td colSpan={6} className="emptyNote">
                  {mailed ? "Nobody's due for a postcard this week." : "Loading…"}
                </td>
              </tr>
            )}
            {batch.map((b) => (
              <tr key={b.customerId}>
                <td>
                  <input
                    type="checkbox"
                    checked={!skip.has(b.customerId)}
                    onChange={() => {
                      const n = new Set(skip);
                      if (n.has(b.customerId)) n.delete(b.customerId);
                      else n.add(b.customerId);
                      setSkip(n);
                    }}
                  />
                </td>
                <td>{b.to.name}</td>
                <td className="muted">
                  {b.to.address_line1}, {b.to.address_city} {b.to.address_zip}
                </td>
                <td>{b.vars.vehicle}</td>
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
