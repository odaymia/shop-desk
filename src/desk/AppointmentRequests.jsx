import { useState, useEffect, useCallback } from "react";
import { Modal, Field, fmtDateTime, fmtPhone } from "./ui.jsx";
import { cloud } from "../storage/index.js";

/* Appointment requests sent from the shop's website. Its own page so a new
   one is easy to spot (the nav shows a count). Each request lists what the
   customer asked for and any note they left; staff can call, text, or email
   the person right from here, then mark it handled. Handling just hides it
   from the list — nothing is deleted. */

/* A preferred day comes back as "YYYY-MM-DD"; format it without letting the
   browser shift it a day for the timezone. */
function fmtDay(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ""));
  if (!m) return String(d || "");
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "there";

/* A friendly, editable confirmation the owner can send back. */
function defaultEmail(r, cfg) {
  const shop = cfg.shopName || "our shop";
  const bits = [];
  if (r.service) bits.push(`for ${r.service}`);
  if (r.vehicle) bits.push(`on your ${r.vehicle}`);
  const line = bits.join(" ");
  const day = r.preferred_day ? ` You asked about ${fmtDay(r.preferred_day)}.` : "";
  const subject = `Your appointment request at ${shop}`;
  const body =
    `Hi ${firstName(r.name)},\n\n` +
    `Thanks for reaching out to ${shop}. We got your request${line ? " " + line : ""}.${day}\n\n` +
    `We'd be glad to get you in. Just reply to this email` +
    (cfg.shopPhone ? ` or give us a call at ${fmtPhone(cfg.shopPhone)}` : "") +
    ` and we'll set up a time that works for you.\n\n` +
    `Thanks,\n${shop}`;
  return { subject, body };
}

function EmailModal({ req, cfg, flash, onClose }) {
  const start = defaultEmail(req, cfg);
  const [subject, setSubject] = useState(start.subject);
  const [body, setBody] = useState(start.body);
  const mailto = `mailto:${encodeURIComponent(req.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const copy = () =>
    navigator.clipboard.writeText(body).then(
      () => flash("Message copied"),
      () => flash("Couldn't copy — select the text and copy it.", "out")
    );
  return (
    <Modal title={`Email ${req.name}`} onClose={onClose} size="wide">
      <Field label="To">
        <input value={req.email} readOnly />
      </Field>
      <Field label="Subject">
        <input value={subject} onChange={(e) => setSubject(e.target.value)} />
      </Field>
      <Field label="Message">
        <textarea rows={9} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <p className="legalNote" style={{ marginTop: 0 }}>
        Opens in your email program so it sends from your own shop address. Edit anything above first.
      </p>
      <div className="rowBtns" style={{ marginTop: 10 }}>
        <a className="btn primary" href={mailto} onClick={onClose}>
          Open in email
        </a>
        <button className="btn" onClick={copy}>
          Copy message
        </button>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export function AppointmentRequests({ cfg, flash, onChange }) {
  const [requests, setRequests] = useState(null); // null = loading
  const [emailing, setEmailing] = useState(null);

  const load = useCallback(() => {
    cloud
      .listSiteRequests()
      .then((r) => setRequests(r || []))
      .catch(() => setRequests([]));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const markHandled = async (id) => {
    await cloud.handleSiteRequest(id);
    setRequests((rs) => (rs || []).filter((r) => r.id !== id));
    if (onChange) onChange();
  };

  const linked = cloud.getState().linked;

  return (
    <>
      <header className="deskHead">
        <h1>Appointment requests</h1>
        {requests && requests.length > 0 && <span className="navCount">{requests.length}</span>}
        <div className="grow" />
        <button className="btn" onClick={load}>
          Refresh
        </button>
      </header>
      <div className="deskBody" style={{ maxWidth: 780 }}>
        <p className="legalNote" style={{ marginTop: 0 }}>
          People who asked for a time through your website. Reach out, then mark it handled — handled requests drop off
          this list. Turn the form on or off under Settings → Website.
        </p>

        {requests === null ? (
          <p className="emptyNote">Loading…</p>
        ) : !linked ? (
          <p className="emptyNote">
            Requests come in once this computer is signed in to your shop and your website is published.
          </p>
        ) : requests.length === 0 ? (
          <p className="emptyNote">No new requests right now. New ones show up here with a count on the menu.</p>
        ) : (
          requests.map((r) => (
          <div key={r.id} className="card apptCard">
            <div className="apptTop">
              <div>
                <b className="apptName">{r.name}</b>
                <span className="apptWhen">Sent {fmtDateTime(new Date(r.created_at).getTime())}</span>
              </div>
              <div className="rowBtns">
                {r.phone && (
                  <a className="btn tiny" href={`tel:${r.phone.replace(/[^\d+]/g, "")}`}>
                    Call
                  </a>
                )}
                {r.phone && (
                  <a className="btn tiny" href={`sms:${r.phone.replace(/[^\d+]/g, "")}`}>
                    Text
                  </a>
                )}
                {r.email && (
                  <button className="btn tiny" onClick={() => setEmailing(r)}>
                    Email
                  </button>
                )}
                <button className="btn tiny primary" onClick={() => markHandled(r.id)}>
                  Mark handled
                </button>
              </div>
            </div>

            <dl className="kv apptKv">
              {r.phone && (
                <>
                  <dt>Phone</dt>
                  <dd>{fmtPhone(r.phone)}</dd>
                </>
              )}
              {r.email && (
                <>
                  <dt>Email</dt>
                  <dd>{r.email}</dd>
                </>
              )}
              <dt>Wants</dt>
              <dd>{r.service || <span style={{ color: "var(--muted)", fontWeight: 400 }}>Not specified</span>}</dd>
              {r.vehicle && (
                <>
                  <dt>Vehicle</dt>
                  <dd>{r.vehicle}</dd>
                </>
              )}
              {r.preferred_day && (
                <>
                  <dt>Preferred day</dt>
                  <dd>{fmtDay(r.preferred_day)}</dd>
                </>
              )}
            </dl>

            {r.note && (
              <div className="apptNote">
                <span className="apptNoteLabel">Their note</span>
                {r.note}
              </div>
            )}
            </div>
          ))
        )}

        {emailing && <EmailModal req={emailing} cfg={cfg} flash={flash} onClose={() => setEmailing(null)} />}
      </div>
    </>
  );
}
