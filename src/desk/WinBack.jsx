import { useMemo, useState } from "react";
import { Modal, Field } from "./ui.jsx";
import { vehicleName } from "./useShop.js";
import { cloud } from "../storage/index.js";
import { renderPostcard, mailingAddress, mailOf } from "../lib/postcards.js";
import { emailOpts } from "./emailRunner.js";

/* Win-back: from the Due-back list, mail an oil-change reminder postcard to the
   overdue customers who have an address, and/or email the ones who have an
   email. Reuses the postcard renderer and the "mail" / "email" Edge Functions
   the Marketing tools already use. */

const fillCard = (html, v) => html.replace(/\{(first_name|vehicle|due_date)\}/g, (_, k) => v[k] || "");
const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(String(e || "").trim());
const firstNameOf = (c) => String((c && c.first) || "").trim() || "there";

function CardPreview({ html, label }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{label}</div>
      <div style={{ width: 420, height: 286, overflow: "hidden", border: "1px solid var(--line)", borderRadius: 6 }}>
        <iframe title={label} srcDoc={html} sandbox="" style={{ width: 600, height: 408, border: 0, transform: "scale(.7)", transformOrigin: "0 0" }} />
      </div>
    </div>
  );
}

export function WinBack({ shop, cfg, rows, onClose, flash }) {
  const [tab, setTab] = useState("card"); // card | email
  const [busy, setBusy] = useState("");
  const m = mailOf(cfg);
  const shopStreet = String(cfg.shopAddress || "").split(",")[0];

  /* one entry per customer (the overdue list can have several of a person's cars) */
  const audience = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const r of rows || []) {
      if (seen.has(r.customerId)) continue;
      seen.add(r.customerId);
      const c = shop.customers[r.customerId];
      if (!c) continue;
      out.push({ customerId: r.customerId, vehicleId: r.vehicleId, customer: c, vehicle: shop.vehicles[r.vehicleId] });
    }
    return out;
  }, [rows, shop.customers, shop.vehicles]);

  const mailable = useMemo(() => audience.map((a) => ({ ...a, to: mailingAddress(a.customer, shopStreet) })).filter((a) => a.to), [audience, shopStreet]);
  const emailable = useMemo(() => audience.filter((a) => validEmail(a.customer.email)), [audience]);

  const card = useMemo(() => renderPostcard(cfg, shop.coupons, emailOpts(), 0, ""), [cfg, shop.coupons]);
  const vehLabel = (a) => vehicleName(a && a.vehicle) || "your vehicle";
  const sample = mailable[0]
    ? { first_name: firstNameOf(mailable[0].customer), vehicle: vehLabel(mailable[0]), due_date: "now" }
    : { first_name: "Maria", vehicle: "2018 Honda Civic", due_date: "now" };

  const costPer = Number(m.costPerCard) || 0;

  const mailCards = async () => {
    if (!mailable.length) return;
    setBusy("mail");
    const batchId = "winback-" + new Date().toISOString().slice(0, 10);
    let mailedN = 0;
    const failed = [];
    try {
      const list = mailable.map((a) => ({
        to: a.to,
        vars: { first_name: firstNameOf(a.customer), vehicle: vehLabel(a), due_date: "now" },
        dedupe: [`winback:${a.vehicleId}:${batchId}`],
        customerId: a.customerId,
      }));
      for (let i = 0; i < list.length; i += 25) {
        const out = await cloud.invoke("mail", { action: "send", batchId, front: card.front, back: card.back, cards: list.slice(i, i + 25) });
        mailedN += (out && out.mailed) || 0;
        failed.push(...((out && out.failed) || []));
      }
      flash(`${mailedN} win-back card${mailedN === 1 ? "" : "s"} on the way${failed.length ? ` · ${failed.length} couldn't be mailed` : ""}`, failed.length ? "out" : undefined);
      onClose();
    } catch {
      flash("Couldn't mail — connect postcards (Lob) under Marketing → Postcards first.", "out");
    } finally {
      setBusy("");
    }
  };

  const [subject, setSubject] = useState(`We miss you at ${cfg.shopName || "our shop"}`);
  const [message, setMessage] = useState(
    `Hi {first_name},\n\nIt's been a while since your {vehicle} came in for an oil change. Swing by ${cfg.shopName || "the shop"} — no appointment needed — and we'll get you back on the road fresh.\n\nSee you soon,\n${cfg.shopName || ""}`
  );
  const emailThem = async () => {
    if (!emailable.length) return;
    setBusy("email");
    try {
      const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#15171b">${message
        .split("\n")
        .map((l) => (l.trim() ? `<p style="margin:0 0 12px">${esc(l)}</p>` : ""))
        .join("")}</div>`;
      const id = await cloud.saveEmailMessage({ kind: "winback", name: "Win-back", subject, html, text: message });
      const recipients = emailable.map((a) => ({ email: a.customer.email, vars: { first_name: firstNameOf(a.customer), vehicle: vehLabel(a) }, dedupe: `winback:${a.customerId}` }));
      const out = await cloud.invoke("email", { action: "queue", messageId: id, recipients });
      flash(`${(out && out.queued) || recipients.length} win-back email${recipients.length === 1 ? "" : "s"} queued.`);
      onClose();
    } catch {
      flash("Couldn't send — connect email (Resend) under Marketing first.", "out");
    } finally {
      setBusy("");
    }
  };

  return (
    <Modal title="Win them back" onClose={onClose} size="huge">
      <div className="seg" style={{ marginBottom: 14 }}>
        <button className={tab === "card" ? "on" : ""} onClick={() => setTab("card")}>
          📮 Postcard · {mailable.length}
        </button>
        <button className={tab === "email" ? "on" : ""} onClick={() => setTab("email")}>
          ✉️ Email · {emailable.length}
        </button>
      </div>

      {tab === "card" ? (
        mailable.length === 0 ? (
          <p className="emptyNote">None of these customers have a complete mailing address on file.</p>
        ) : (
          <>
            <p className="legalNote" style={{ marginTop: 0 }}>
              Mail an oil-change reminder card to the {mailable.length} overdue customer{mailable.length === 1 ? "" : "s"} who{" "}
              {mailable.length === 1 ? "has" : "have"} a mailing address
              {costPer ? ` — about $${(mailable.length * costPer).toFixed(2)} at $${costPer.toFixed(2)} a card` : ""}. Each card
              merges in the name, vehicle, and your current offer.
            </p>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <CardPreview html={fillCard(card.front, sample)} label="Front" />
              <CardPreview html={fillCard(card.back, sample)} label="Back (message)" />
            </div>
            <div className="rowBtns" style={{ marginTop: 14 }}>
              <button className="btn primary lg" disabled={busy === "mail"} onClick={mailCards}>
                {busy === "mail" ? "Sending…" : `Mail ${mailable.length} card${mailable.length === 1 ? "" : "s"}`}
              </button>
              <button className="btn lg" onClick={onClose}>
                Cancel
              </button>
            </div>
            <p className="legalNote">Uses your postcard setup (Marketing → Postcards). Connect Lob there first if you haven't.</p>
          </>
        )
      ) : emailable.length === 0 ? (
        <p className="emptyNote">None of these customers have an email address on file.</p>
      ) : (
        <>
          <p className="legalNote" style={{ marginTop: 0 }}>
            Email the {emailable.length} overdue customer{emailable.length === 1 ? "" : "s"} who{" "}
            {emailable.length === 1 ? "has" : "have"} an email on file. &#123;first_name&#125; and &#123;vehicle&#125; fill in for each person.
          </p>
          <Field label="Subject">
            <input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field label="Message">
            <textarea rows={8} value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>
          <div className="rowBtns" style={{ marginTop: 10 }}>
            <button className="btn primary lg" disabled={busy === "email"} onClick={emailThem}>
              {busy === "email" ? "Sending…" : `Email ${emailable.length}`}
            </button>
            <button className="btn lg" onClick={onClose}>
              Cancel
            </button>
          </div>
          <p className="legalNote">Uses your email setup (Marketing). Connect Resend there first if you haven't.</p>
        </>
      )}
    </Modal>
  );
}
