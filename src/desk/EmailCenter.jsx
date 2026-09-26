import { useState, useEffect, useMemo } from "react";
import { cloud } from "../storage/index.js";
import { Field, Text, Modal, fmtDate } from "./ui.jsx";
import { EmailList } from "./EmailList.jsx";
import { buildEmailList, filterEmailList } from "../lib/emailList.js";
import { composeEmail } from "../lib/emailCompose.js";
import { fillPlaceholders } from "../lib/emailRender.js";
import { automationsOf, AUTOMATION_INFO, DEFAULT_AUTOMATIONS } from "../lib/emailAutomations.js";
import { couponText } from "../lib/website.js";
import { runAutomations, emailOpts } from "./emailRunner.js";
import { Postcards } from "./Postcards.jsx";

/* Marketing: write and send email campaigns, set up the automatic emails,
   mail oil change postcards, the email list, and the sender settings. Sending itself happens in the "email" Edge
   Function (supabase/functions/email), through Resend. */

const TABS = [
  ["campaigns", "Campaigns"],
  ["automations", "Automations"],
  ["postcards", "Postcards"],
  ["list", "Email list"],
  ["settings", "Email settings"],
];
const lsGet = (k, d) => {
  try {
    const v = localStorage.getItem(k);
    return v == null ? d : JSON.parse(v);
  } catch {
    return d;
  }
};
const lsSet = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* private window */
  }
};
const emailOf = (cfg) => ({ enabled: true, fromName: "", fromEmail: "", replyTo: "", dailyLimit: 100, ...((cfg && cfg.email) || {}) });

export function EmailCenter({ shop, cfg, saveCfg, flash }) {
  const [tab, setTabState] = useState(() => lsGet("bb:emailTab", "campaigns"));
  const setTab = (t) => {
    setTabState(t);
    lsSet("bb:emailTab", t);
  };
  return (
    <>
      <header className="deskHead">
        <h1>Marketing</h1>
        <div className="seg">
          {TABS.map(([k, l]) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
              {l}
            </button>
          ))}
        </div>
      </header>
      {tab === "campaigns" && <Campaigns shop={shop} cfg={cfg} flash={flash} />}
      {tab === "automations" && <Automations shop={shop} cfg={cfg} saveCfg={saveCfg} flash={flash} />}
      {tab === "postcards" && <Postcards shop={shop} cfg={cfg} saveCfg={saveCfg} flash={flash} />}
      {tab === "list" && <EmailList shop={shop} flash={flash} />}
      {tab === "settings" && <EmailSettings cfg={cfg} saveCfg={saveCfg} flash={flash} />}
    </>
  );
}

/* ---------- shared bits ---------- */

function Preview({ html, first = "Ana" }) {
  const doc = useMemo(() => fillPlaceholders(html, { first_name: first, vehicle: "2018 Honda Civic", due_date: "October 12", unsubscribe_url: "#" }), [html, first]);
  return <iframe title="Email preview" srcDoc={doc} sandbox="" style={{ width: "100%", height: 640, border: "1px solid var(--line)", borderRadius: 10, background: "#f2efe9" }} />;
}

const activeCoupons = (shop) =>
  Object.values(shop.coupons || {})
    .filter((c) => c && c.active !== false && !c.deleted && (!c.endsAt || c.endsAt >= new Date().toISOString().slice(0, 10)))
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));

function CouponPick({ shop, value, onChange }) {
  return (
    <select value={value || ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">No coupon</option>
      {activeCoupons(shop).map((c) => (
        <option key={c.id} value={c.id}>
          {c.code} — {c.name || couponText(c)}
          {c.endsAt ? ` (ends ${c.endsAt})` : ""}
        </option>
      ))}
    </select>
  );
}

function ButtonPick({ value, onChange }) {
  return (
    <select value={value || ""} onChange={(e) => onChange(e.target.value)}>
      <option value="site">Button to our website (or the coupon's page)</option>
      <option value="review">Button: leave us a Google review</option>
      <option value="custom">Button to a link I choose</option>
      <option value="">No button</option>
    </select>
  );
}

/* ---------- campaigns ---------- */

const blankCampaign = () => ({ name: "", subject: "", preheader: "", headline: "", body: "Hi {first_name},\n\n", couponId: "", button: "site", buttonLabel: "", buttonUrl: "", who: "all", since: "any", when: "" });

function Campaigns({ shop, cfg, flash }) {
  const [list, setList] = useState([]);
  const [err, setErr] = useState("");
  const [draft, setDraftState] = useState(() => lsGet("bb:emailDraft", null));
  const setDraft = (d) => {
    setDraftState(d);
    lsSet("bb:emailDraft", d);
  };
  const load = () =>
    cloud
      .listEmailMessages()
      .then((l) => {
        setList(l.filter((m) => m.kind === "campaign"));
        setErr("");
      })
      .catch((e) => setErr(/email_messages|schema cache|does not exist/i.test(e.message || "") ? "Email isn't set up yet: run supabase/email.sql in Supabase (see Settings)." : e.message));
  useEffect(() => {
    load();
  }, []);

  if (draft) return <Composer shop={shop} cfg={cfg} flash={flash} draft={draft} setDraft={setDraft} onDone={() => (setDraft(null), load())} />;

  return (
    <div className="deskBody">
      <div className="rowBtns" style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={() => setDraft(blankCampaign())}>
          New campaign
        </button>
      </div>
      {err && <p className="legalNote" style={{ color: "#b42318" }}>{err}</p>}
      <div className="tableCard">
        <table className="dk">
          <thead>
            <tr>
              <th>Sent</th>
              <th>Campaign</th>
              <th>To</th>
              <th className="r">Sent</th>
              <th className="r">Waiting</th>
              <th className="r">Didn't send</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={6} className="emptyNote">
                  No campaigns yet. Write one to your whole list, or just the people who haven't been in for a while.
                </td>
              </tr>
            )}
            {list.map((m) => (
              <tr key={m.id}>
                <td className="muted">{fmtDate(new Date(m.created_at).getTime())}</td>
                <td>
                  <b>{m.name || m.subject}</b>
                  {m.name ? <div className="sub muted">{m.subject}</div> : null}
                </td>
                <td className="muted">{(m.audience && m.audience.label) || ""}</td>
                <td className="r num">{m.counts.sent || 0}</td>
                <td className="r num">{(m.counts.queued || 0) + (m.counts.sending || 0)}</td>
                <td className="r num">{(m.counts.failed || 0) + (m.counts.skipped || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="legalNote">
        "Waiting" emails go out as your daily limit allows (Email → Settings). "Didn't send" is people who unsubscribed in
        the meantime, or addresses the mail service refused.
      </p>
    </div>
  );
}

const WHO = [
  ["all", "Everyone on the list"],
  ["customers", "Customers"],
  ["website", "Website signups & imports"],
];
const SINCE = [
  ["any", "Any last visit"],
  ["6mo", "Visited in the last 6 months"],
  ["6to12", "Last visit 6–12 months ago"],
  ["12plus", "Haven't been in for over a year"],
  ["never", "No visits on record"],
];

function Composer({ shop, cfg, flash, draft, setDraft, onDone }) {
  const set = (k) => (v) => setDraft({ ...draft, [k]: v });
  const [signups, setSignups] = useState([]);
  const [supp, setSupp] = useState(new Set());
  const [testTo, setTestTo] = useState(() => lsGet("bb:emailTestTo", cfg.shopEmail || ""));
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    cloud.listSiteSignups().then(setSignups).catch(() => {});
    cloud.listSuppressions().then((l) => setSupp(new Set(l.map((x) => x.email))));
  }, []);
  const { rows } = useMemo(() => buildEmailList({ customers: shop.customers, orders: shop.orders, signups, suppressed: supp }), [shop.customers, shop.orders, signups, supp]);
  const audience = useMemo(() => filterEmailList(rows, { who: draft.who, since: draft.since }), [rows, draft.who, draft.since]);
  const msg = useMemo(() => composeEmail(cfg, shop.coupons, draft, emailOpts()), [cfg, shop.coupons, draft]);
  const label = [WHO.find((w) => w[0] === draft.who)[1], draft.since !== "any" ? SINCE.find((s) => s[0] === draft.since)[1].toLowerCase() : ""].filter(Boolean).join(", ");
  const limit = emailOf(cfg).dailyLimit;
  const ready = draft.subject.trim() && draft.body.trim();

  const save = (kind = "campaign") => cloud.saveEmailMessage({ kind, name: draft.name, subject: msg.subject, html: msg.html, text: msg.text, audience: { who: draft.who, since: draft.since, label, count: audience.length } });

  const sendTest = async () => {
    setBusy("test");
    try {
      lsSet("bb:emailTestTo", testTo);
      const id = await save("test");
      await cloud.invoke("email", { action: "test", messageId: id, to: testTo, firstName: (cfg.shopName || "").split(" ")[0] });
      flash(`Test sent to ${testTo}`);
    } catch (e) {
      flash(await errText(e), "out");
    } finally {
      setBusy("");
    }
  };
  const send = async () => {
    setConfirm(false);
    setBusy("send");
    try {
      const id = await save();
      const sendAfter = draft.when ? new Date(draft.when).toISOString() : undefined;
      let queued = 0;
      const people = audience.map((r) => ({ email: r.email, vars: { first_name: r.first } }));
      for (let i = 0; i < people.length; i += 1000) {
        const out = await cloud.invoke("email", { action: "queue", messageId: id, recipients: people.slice(i, i + 1000), sendAfter });
        queued += out.queued || 0;
      }
      const days = Math.ceil(queued / limit);
      flash(`${queued.toLocaleString()} emails ${draft.when ? `scheduled for ${new Date(draft.when).toLocaleString()}` : "on their way"}${days > 1 ? ` · about ${days} days at your limit of ${limit}/day` : ""}`);
      onDone();
    } catch (e) {
      flash(await errText(e), "out");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="deskBody">
      <div className="rowBtns" style={{ marginBottom: 12, alignItems: "center" }}>
        <button className="btn" onClick={() => setDraft(null)}>
          ← Campaigns
        </button>
        <span className="muted">Your draft is kept on this computer until you send it.</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 1fr) minmax(320px, 1fr)", gap: 24, alignItems: "start" }}>
        <div>
          <Field label="Campaign name (only you see this)">
            <Text value={draft.name} onChange={set("name")} placeholder="October oil change special" />
          </Field>
          <Field label="Subject line">
            <Text value={draft.subject} onChange={set("subject")} placeholder="{first_name}, $20 off your next oil change" maxLength={120} />
          </Field>
          <Field label="Preview text (the gray line after the subject in the inbox)">
            <Text value={draft.preheader} onChange={set("preheader")} placeholder="This week only, no appointment needed" maxLength={140} />
          </Field>
          <Field label="Headline">
            <Text value={draft.headline} onChange={set("headline")} placeholder="Save on your next oil change" />
          </Field>
          <Field label="Message (a blank line starts a new paragraph; {first_name} becomes their name)">
            <textarea rows={8} value={draft.body} onChange={(e) => set("body")(e.target.value)} />
          </Field>
          <Field label="Coupon">
            <CouponPick shop={shop} value={draft.couponId} onChange={set("couponId")} />
          </Field>
          <div className="fldRow">
            <Field label="Button">
              <ButtonPick value={draft.button} onChange={set("button")} />
            </Field>
            {draft.button && (
              <Field label="Button text">
                <Text value={draft.buttonLabel} onChange={set("buttonLabel")} placeholder={draft.button === "review" ? "Leave us a review" : draft.couponId ? "See the offer" : "Visit our website"} />
              </Field>
            )}
          </div>
          {draft.button === "custom" && (
            <Field label="Button link">
              <Text value={draft.buttonUrl} onChange={set("buttonUrl")} placeholder="https://…" />
            </Field>
          )}

          <h3 className="subhead" style={{ marginTop: 24 }}>
            Who gets it
          </h3>
          <div className="fldRow">
            <Field label="People">
              <select value={draft.who} onChange={(e) => set("who")(e.target.value)}>
                {WHO.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Last visit">
              <select value={draft.since} onChange={(e) => set("since")(e.target.value)}>
                {SINCE.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p style={{ margin: "4px 0 0" }}>
            <b>{audience.length.toLocaleString()}</b> {audience.length === 1 ? "person" : "people"} (unsubscribed people are always left out)
            {audience.length > limit ? ` · at your limit of ${limit}/day this takes about ${Math.ceil(audience.length / limit)} days` : ""}
          </p>

          <h3 className="subhead" style={{ marginTop: 24 }}>
            Send
          </h3>
          <div className="rowBtns" style={{ alignItems: "flex-end" }}>
            <Field label="Send a test to">
              <Text value={testTo} onChange={setTestTo} placeholder="you@yourshop.com" />
            </Field>
            <button className="btn" disabled={!ready || !testTo || !!busy} onClick={sendTest}>
              {busy === "test" ? "Sending…" : "Send test"}
            </button>
          </div>
          <div className="rowBtns" style={{ alignItems: "flex-end", marginTop: 10 }}>
            <Field label="When (leave blank to send now)">
              <input type="datetime-local" value={draft.when} onChange={(e) => set("when")(e.target.value)} />
            </Field>
            <button className="btn primary" disabled={!ready || !audience.length || !!busy} onClick={() => setConfirm(true)}>
              {busy === "send" ? "Sending…" : draft.when ? "Schedule" : "Send now"}
            </button>
          </div>
        </div>
        <div>
          <p className="muted" style={{ margin: "0 0 6px" }}>
            <b>Subject:</b> {fillPlaceholders(msg.subject, { first_name: "Ana" }, { html: false })}
          </p>
          <Preview html={msg.html} />
        </div>
      </div>
      {confirm && (
        <Modal title={draft.when ? "Schedule this email?" : "Send this email?"} onClose={() => setConfirm(false)}>
          <p>
            <b>{fillPlaceholders(msg.subject, { first_name: "Ana" }, { html: false })}</b>
            <br />
            to {audience.length.toLocaleString()} {audience.length === 1 ? "person" : "people"} ({label})
            {draft.when ? <><br />on {new Date(draft.when).toLocaleString()}</> : null}
          </p>
          <p className="muted">Once it's sent it can't be unsent. Send yourself a test first if you haven't.</p>
          <div className="rowBtns">
            <button className="btn primary" onClick={send}>
              {draft.when ? "Schedule it" : `Send to ${audience.length.toLocaleString()}`}
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

/* supabase.functions.invoke hides the function's message inside the error */
async function errText(e) {
  try {
    const body = e && e.context && typeof e.context.json === "function" ? await e.context.json() : null;
    if (body && body.error) return body.error;
  } catch {
    /* not JSON */
  }
  return (e && e.message) || "Something went wrong";
}

/* ---------- automations ---------- */

function Automations({ shop, cfg, saveCfg, flash }) {
  const [auto, setAuto] = useState(() => automationsOf(cfg));
  const [open, setOpen] = useState("");
  const [stats, setStats] = useState({});
  const [running, setRunning] = useState(false);
  useEffect(() => setAuto(automationsOf(cfg)), [cfg]);
  useEffect(() => {
    cloud
      .listEmailMessages(200)
      .then((l) => {
        const month = Date.now() - 30 * 86400000;
        const s = {};
        for (const m of l) if (m.kind !== "campaign" && Date.parse(m.created_at) > month) s[m.kind] = (s[m.kind] || 0) + (m.counts.sent || 0);
        setStats(s);
      })
      .catch(() => {});
  }, []);
  const setA = (k, patch) => setAuto({ ...auto, [k]: { ...auto[k], ...patch } });
  const save = async (next = auto) => {
    await saveCfg({ ...cfg, email: { ...emailOf(cfg), automations: next } });
    flash("Automations saved");
  };
  const runNow = async () => {
    setRunning(true);
    try {
      const r = await runAutomations(shop, { ...cfg, email: { ...emailOf(cfg), automations: auto } });
      const parts = Object.entries(r).map(([k, v]) => `${AUTOMATION_INFO[k].title}: ${v.queued}`);
      flash(parts.length ? `Queued today — ${parts.join(" · ")}` : "Nobody is due today");
    } catch (e) {
      flash(await errText(e), "out");
    } finally {
      setRunning(false);
    }
  };

  const extra = {
    thanks: ["delayDays", "Days after the visit", 0, 7],
    oil: ["leadDays", "Days before the sticker date", 0, 14],
    winback: ["months", "Months without a visit", 2, 24],
  };

  return (
    <div className="deskBody">
      <p className="legalNote" style={{ marginTop: 0 }}>
        These go out by themselves, checked once a day while the desk is open. Each person gets each email once, and
        turning one on only starts with people who come due from now on, so it never emails your whole history at once.
      </p>
      <div className="rowBtns" style={{ marginBottom: 14 }}>
        <button className="btn" disabled={running || !Object.values(auto).some((a) => a.on)} onClick={runNow}>
          {running ? "Checking…" : "Check and send now"}
        </button>
      </div>
      {Object.keys(DEFAULT_AUTOMATIONS).map((k) => {
        const a = auto[k];
        const info = AUTOMATION_INFO[k];
        const msg = open === k ? composeEmail(cfg, shop.coupons, a, emailOpts()) : null;
        return (
          <div key={k} className="card" style={{ padding: 16, marginBottom: 12 }}>
            <div className="rowBtns" style={{ alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <b style={{ fontSize: 17 }}>{info.title}</b>
                <div className="muted">
                  {info.when}
                  {stats[k] ? ` · ${stats[k]} sent in the last 30 days` : ""}
                </div>
              </div>
              <div className="rowBtns" style={{ alignItems: "center" }}>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={!!a.on}
                    onChange={(e) => {
                      const next = { ...auto, [k]: { ...a, on: e.target.checked } };
                      setAuto(next);
                      save(next);
                    }}
                  />
                  {a.on ? "On" : "Off"}
                </label>
                <button className="btn tiny" onClick={() => setOpen(open === k ? "" : k)}>
                  {open === k ? "Close" : "Edit"}
                </button>
              </div>
            </div>
            {open === k && (
              <div style={{ display: "grid", gridTemplateColumns: "minmax(300px,1fr) minmax(300px,1fr)", gap: 20, marginTop: 14 }}>
                <div>
                  {extra[k] && (
                    <Field label={extra[k][1]}>
                      <input type="number" min={extra[k][2]} max={extra[k][3]} value={a[extra[k][0]]} onChange={(e) => setA(k, { [extra[k][0]]: Number(e.target.value) })} />
                    </Field>
                  )}
                  <Field label="Subject line">
                    <Text value={a.subject} onChange={(v) => setA(k, { subject: v })} />
                  </Field>
                  <Field label="Headline">
                    <Text value={a.headline} onChange={(v) => setA(k, { headline: v })} />
                  </Field>
                  <Field label={`Message ({first_name}${k === "oil" ? ", {vehicle}, {due_date}" : ""} fill in per person)`}>
                    <textarea rows={7} value={a.body} onChange={(e) => setA(k, { body: e.target.value })} />
                  </Field>
                  <Field label="Coupon">
                    <CouponPick shop={shop} value={a.couponId} onChange={(v) => setA(k, { couponId: v })} />
                  </Field>
                  <Field label="Button">
                    <ButtonPick value={a.button} onChange={(v) => setA(k, { button: v })} />
                  </Field>
                  {a.button === "review" && !((cfg.website || {}).links || {}).google && (
                    <p className="legalNote">Add your Google review link in Settings → Website → Review and social pages, or the button points to your website.</p>
                  )}
                  <div className="rowBtns" style={{ marginTop: 10 }}>
                    <button className="btn primary" onClick={() => save()}>
                      Save
                    </button>
                    <button className="btn" onClick={() => setAuto({ ...auto, [k]: { ...DEFAULT_AUTOMATIONS[k], on: a.on } })}>
                      Reset the wording
                    </button>
                  </div>
                </div>
                <div>
                  <p className="muted" style={{ margin: "0 0 6px" }}>
                    <b>Subject:</b> {fillPlaceholders(msg.subject, { first_name: "Ana", vehicle: "2018 Honda Civic", due_date: "October 12" }, { html: false })}
                  </p>
                  <Preview html={msg.html} />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- settings ---------- */

function EmailSettings({ cfg, saveCfg, flash }) {
  const [e, setE] = useState(() => emailOf(cfg));
  const [status, setStatus] = useState(null);
  const [statusErr, setStatusErr] = useState("");
  useEffect(() => setE(emailOf(cfg)), [cfg]);
  const loadStatus = () =>
    cloud
      .invoke("email", { action: "status" })
      .then((s) => {
        setStatus(s);
        setStatusErr("");
      })
      .catch(async (err) => setStatusErr((await errText(err)) || "The email function isn't deployed yet."));
  useEffect(() => {
    loadStatus();
  }, []);
  const set = (k) => (v) => setE({ ...e, [k]: v });
  const save = async () => {
    await saveCfg({ ...cfg, email: { ...e, dailyLimit: Math.max(1, Math.floor(Number(e.dailyLimit) || 100)) } });
    flash("Email settings saved");
    setTimeout(loadStatus, 1500);
  };
  const domain = (cfg.website && cfg.website.domain ? cfg.website.domain : "").replace(/^www\./, "");

  return (
    <div className="deskBody" style={{ maxWidth: 820 }}>
      <div className="card" style={{ padding: 16, marginBottom: 18 }}>
        {status ? (
          <>
            <b style={{ color: status.ready ? "var(--green, #1f8a4c)" : "#b42318" }}>{status.ready ? "Ready to send" : "Not ready to send yet"}</b>
            <div className="muted" style={{ marginTop: 6 }}>
              From: {status.from || "—"} · Replies go to: {status.replyTo || "—"}
              <br />
              Sent today: {status.sentToday} of {status.dailyLimit} · Waiting: {status.queued}
              {!status.hasKey ? <><br />The email function has no RESEND_API_KEY yet.</> : null}
            </div>
          </>
        ) : (
          <>
            <b style={{ color: "#b42318" }}>Not connected</b>
            <div className="muted" style={{ marginTop: 6 }}>{statusErr || "Checking…"}</div>
          </>
        )}
      </div>
      <Field label="Email">
        <select value={e.enabled ? "on" : "off"} onChange={(ev) => set("enabled")(ev.target.value === "on")}>
          <option value="on">On</option>
          <option value="off">Off — nothing is sent (campaigns and automations wait)</option>
        </select>
      </Field>
      <div className="fldRow">
        <Field label="From name">
          <Text value={e.fromName} onChange={set("fromName")} placeholder={cfg.shopName || "Your shop"} />
        </Field>
        <Field label="From address (on your verified domain)">
          <Text value={e.fromEmail} onChange={set("fromEmail")} placeholder={domain ? `deals@${domain}` : "deals@yourshop.com"} />
        </Field>
      </div>
      <div className="fldRow">
        <Field label="Replies go to">
          <Text value={e.replyTo} onChange={set("replyTo")} placeholder={cfg.shopEmail || "you@yourshop.com"} />
        </Field>
        <Field label="Most emails a day">
          <input type="number" min={1} value={e.dailyLimit} onChange={(ev) => set("dailyLimit")(ev.target.value)} />
        </Field>
      </div>
      <p className="legalNote" style={{ marginTop: 0 }}>
        Match "Most emails a day" to your Resend plan: 100 on the free plan. Anything over waits for the next day.
      </p>
      <button className="btn primary" onClick={save}>
        Save
      </button>

      <h3 className="subhead" style={{ marginTop: 30 }}>
        Setting it up (once)
      </h3>
      <ol className="legalNote" style={{ paddingLeft: 20, lineHeight: 1.7 }}>
        <li>Run supabase/email.sql in the Supabase SQL editor.</li>
        <li>
          Make a Resend account (resend.com), add your domain{domain ? ` (${domain})` : ""} under Domains, and add the DNS
          records it shows you at your domain company. Leave your existing MX records alone.
        </li>
        <li>In Resend → API Keys, create a key with "Sending access".</li>
        <li>
          Deploy the email function (supabase/functions/email) with JWT verification off, and add its secrets:
          RESEND_API_KEY, EMAIL_SECRET, EMAIL_UNSUB_PAGE.
        </li>
        <li>Fill in the From address above, save, and send yourself a test from a campaign.</li>
      </ol>
      <p className="legalNote">
        Every email carries your shop's address and an unsubscribe link, and anyone who unsubscribes is never emailed again
        from here, as the CAN-SPAM Act requires.
      </p>
    </div>
  );
}
