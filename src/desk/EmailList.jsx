import { useState, useEffect, useMemo } from "react";
import { cloud } from "../storage/index.js";
import { fmtDate } from "./ui.jsx";
import { buildEmailList, filterEmailList, emailListCsv, importCandidates, sourceLabel } from "../lib/emailList.js";

/* Email list: every customer with an email on file plus everyone who signed
   up on the website, one row per address. Copy the addresses or download a
   CSV for the shop's email service. Unsubscribing marks the person so they
   drop out of every copy and export from then on. */

const SHOW = 300; // rows drawn at once; search or filter to narrow, exports take everything

function download(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function EmailList({ shop, flash }) {
  const [signups, setSignups] = useState([]);
  const [suppressed, setSuppressedList] = useState(new Set());
  const [signupErr, setSignupErr] = useState("");
  const [who, setWho] = useState("all");
  const [since, setSince] = useState("any");
  const [q, setQ] = useState("");

  const loadSignups = () =>
    cloud
      .listSiteSignups()
      .then((s) => {
        setSignups(s);
        setSignupErr("");
      })
      .catch((e) => setSignupErr(/site_signups|schema cache|does not exist/i.test(e.message || "") ? "Website signups need the latest supabase/website.sql run once in Supabase." : e.message));
  const loadSuppressed = () => cloud.listSuppressions().then((l) => setSuppressedList(new Set(l.map((x) => x.email))));
  useEffect(() => {
    loadSignups();
    loadSuppressed();
  }, []);

  const { rows, invalid } = useMemo(() => buildEmailList({ customers: shop.customers, orders: shop.orders, signups, suppressed }), [shop.customers, shop.orders, signups, suppressed]);
  const shown = useMemo(() => filterEmailList(rows, { who, since, q }), [rows, who, since, q]);
  const counts = useMemo(() => {
    const monthAgo = Date.now() - 30 * 86400000;
    let subscribed = 0, customers = 0, website = 0, fresh = 0, unsub = 0;
    for (const r of rows) {
      if (r.unsubscribed) {
        unsub++;
        continue;
      }
      subscribed++;
      if (r.customer) customers++;
      if (r.website) website++;
      if (r.website && r.signedUpAt > monthAgo) fresh++;
    }
    return { subscribed, customers, website, fresh, unsub };
  }, [rows]);

  const setUnsub = async (r, value) => {
    try {
      for (const id of r.customerIds) {
        const c = shop.customers[id];
        if (c) await shop.saveCustomer({ ...c, emailOptOut: value });
      }
      await cloud.setSignupUnsubscribed(r.signupIds, value);
      await cloud.setSuppressed(r.email, value); // the sender checks this list too
      if (r.signupIds.length) loadSignups();
      loadSuppressed();
      flash(value ? `${r.email} unsubscribed` : `${r.email} is back on the list`);
    } catch (e) {
      flash(e.message, "out");
    }
  };

  const [importing, setImporting] = useState(false);
  const importFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    setImporting(true);
    try {
      const { add, skipped } = importCandidates(await f.text(), rows.map((r) => r.email));
      const source = /shopify/i.test(f.name) || /customers_export/i.test(f.name) ? "SHOPIFY" : "IMPORT";
      const added = add.length ? await cloud.addSiteSignups(add, source) : 0;
      await loadSignups();
      const notes = [
        skipped.already && `${skipped.already.toLocaleString()} already on your list`,
        skipped.noConsent && `${skipped.noConsent.toLocaleString()} left out because they didn't agree to marketing email`,
        skipped.invalid && `${skipped.invalid.toLocaleString()} with no valid email`,
      ].filter(Boolean);
      flash(`Added ${added.toLocaleString()} ${added === 1 ? "person" : "people"}${notes.length ? ` · ${notes.join(" · ")}` : ""}`);
    } catch (err) {
      flash(err.message, "out");
    } finally {
      setImporting(false);
    }
  };

  const copy = () => {
    const list = shown.filter((r) => !r.unsubscribed).map((r) => r.email);
    navigator.clipboard.writeText(list.join(", ")).then(
      () => flash(`${list.length.toLocaleString()} addresses copied`),
      () => flash("Couldn't copy. Use Download CSV instead.", "out")
    );
  };

  return (
    <>
      <div className="deskHead" style={{ borderTop: 0 }}>
        <div className="seg">
          {[
            ["all", `Everyone (${counts.subscribed.toLocaleString()})`],
            ["customers", `Customers (${counts.customers.toLocaleString()})`],
            ["website", `Signups & imports (${counts.website.toLocaleString()})`],
            ["unsubscribed", `Unsubscribed (${counts.unsub.toLocaleString()})`],
          ].map(([k, label]) => (
            <button key={k} className={who === k ? "on" : ""} onClick={() => setWho(k)}>
              {label}
            </button>
          ))}
        </div>
        <div className="grow" />
        <label className="btn" title="Bring in a list exported from Shopify, Mailchimp, or any CSV with an Email column">
          {importing ? "Importing…" : "Import list"}
          <input type="file" accept=".csv,text/csv" style={{ display: "none" }} disabled={importing} onChange={importFile} />
        </label>
        <button className="btn" onClick={copy} disabled={!shown.length || who === "unsubscribed"}>
          Copy emails
        </button>
        <button
          className="btn primary"
          disabled={!shown.length || who === "unsubscribed"}
          onClick={() => download(`email-list-${new Date().toISOString().slice(0, 10)}.csv`, emailListCsv(shown))}
        >
          Download CSV
        </button>
      </div>
      <div className="deskBody">
        <div className="rowBtns" style={{ alignItems: "center", marginBottom: 12, gap: 12 }}>
          <input style={{ minWidth: 260 }} placeholder="Search name, email, phone" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={since} onChange={(e) => setSince(e.target.value)}>
            <option value="any">Any last visit</option>
            <option value="6mo">Visited in the last 6 months</option>
            <option value="6to12">Last visit 6–12 months ago</option>
            <option value="12plus">Haven't been in for over a year</option>
            <option value="never">No visits on record</option>
          </select>
          <span className="muted">
            {shown.length.toLocaleString()} {shown.length === 1 ? "person" : "people"}
            {counts.fresh ? ` · ${counts.fresh} new from the website this month` : ""}
          </span>
        </div>
        {signupErr && <p className="legalNote" style={{ color: "var(--red, #b42318)" }}>{signupErr}</p>}
        <div className="tableCard">
          <table className="dk">
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>From</th>
                <th className="r">Visits</th>
                <th>Last visit</th>
                <th>Signed up</th>
                <th className="r" />
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={7} className="emptyNote">
                    {rows.length ? "Nobody matches." : "No emails yet. Add emails to customers, or turn on the website signup box."}
                  </td>
                </tr>
              )}
              {shown.slice(0, SHOW).map((r) => (
                <tr key={r.email.toLowerCase()}>
                  <td>{r.email}</td>
                  <td>{[r.first, r.last].filter(Boolean).join(" ")}</td>
                  <td className="muted">
                    {[r.customer && "Customer", sourceLabel(r)].filter(Boolean).join(" + ")}
                  </td>
                  <td className="r num">{r.visits || ""}</td>
                  <td className="muted">{r.lastVisit ? fmtDate(r.lastVisit) : ""}</td>
                  <td className="muted">{r.signedUpAt ? fmtDate(r.signedUpAt) : ""}</td>
                  <td className="r">
                    <button className="btn tiny" onClick={() => setUnsub(r, !r.unsubscribed)}>
                      {r.unsubscribed ? "Resubscribe" : "Unsubscribe"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shown.length > SHOW && (
          <p className="legalNote">
            Showing the first {SHOW} of {shown.length.toLocaleString()}. Search or filter to find someone; Copy and Download include all{" "}
            {shown.length.toLocaleString()}.
          </p>
        )}
        <p className="legalNote">
          Customers come from the email on their record{invalid ? ` (${invalid.toLocaleString()} left out because the address isn't valid)` : ""}. Website signups come from the
          "Get specials by email" box on your site. Send your email through a service like Mailchimp or Constant Contact:
          import the CSV there and it adds the unsubscribe link every marketing email needs. When someone unsubscribes there,
          mark them here too so they don't come back on your next export.
        </p>
      </div>
    </>
  );
}
