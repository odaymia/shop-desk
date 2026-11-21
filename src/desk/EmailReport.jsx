import { useMemo, useState } from "react";
import { Modal, fmtDate } from "./ui.jsx";
import { fmtMoney } from "../lib/invoice.js";
import { campaignNumbers, pct, linkTable, campaignResults, recipientsWho } from "../lib/emailStats.js";

/* How one campaign went: what the mail service reported (delivered, opened,
   clicked, bounced, marked as spam), which links got the clicks, and who came
   in afterward according to the shop's own tickets.

   `message` is the campaign's row from the list; `detail` is
   { rows, clicks, tracking } from cloud.emailCampaignDetail, or null while it
   loads. `onFollowUp(label, emails)` starts a new campaign to a group. */

const WINDOW_DAYS = 30;
const GROUPS = [
  ["clicked", "Clicked"],
  ["opened", "Opened"],
  ["quiet", "Didn't open"],
  ["bounced", "Bounced"],
  ["complained", "Marked as spam"],
];

function Tile({ label, value, sub, tone }) {
  return (
    <div className={`emTile ${tone || ""}`}>
      <span className="emTileLabel">{label}</span>
      <b className="emTileValue">{value}</b>
      {sub ? <span className="emTileSub">{sub}</span> : null}
    </div>
  );
}

export function EmailReport({ message, detail, shop, cfg, onClose, onFollowUp }) {
  const [group, setGroup] = useState("clicked");
  const n = campaignNumbers(message);
  const rows = detail ? detail.rows : null;
  const links = useMemo(() => linkTable(detail ? detail.clicks : []), [detail]);
  const results = useMemo(
    () => (rows ? campaignResults({ rows, customers: shop.customers, orders: shop.orders, cfg, windowDays: WINDOW_DAYS }) : null),
    [rows, shop.customers, shop.orders, cfg]
  );
  const people = useMemo(() => (rows ? recipientsWho(rows, group) : []), [rows, group]);
  /* names for the email addresses, from the customer list */
  const nameOf = useMemo(() => {
    const m = new Map();
    for (const c of Object.values(shop.customers || {})) {
      const e = String((c && c.email) || "").trim().toLowerCase();
      if (e && !m.has(e)) m.set(e, [c.first, c.last].filter(Boolean).join(" ") || c.company || "");
    }
    return (email) => m.get(String(email || "").trim().toLowerCase()) || "";
  }, [shop.customers]);
  const title = message.name || message.subject;
  const tracked = n.tracked;
  const groupLabel = (GROUPS.find((g) => g[0] === group) || GROUPS[0])[1];

  return (
    <Modal title="How it went" onClose={onClose} size="huge">
      <div className="emHead">
        <strong>{title}</strong>
        <span className="muted">
          {message.name ? `${message.subject} · ` : ""}
          {fmtDate(new Date(message.created_at).getTime())}
          {message.audience && message.audience.label ? ` · ${message.audience.label}` : ""}
        </span>
      </div>

      <div className="emTiles">
        <Tile label="Sent" value={n.sent.toLocaleString()} />
        <Tile label="Delivered" value={tracked ? n.delivered.toLocaleString() : "—"} sub={tracked ? n.deliveredRate : ""} />
        <Tile label="Opened" value={tracked ? n.opened.toLocaleString() : "—"} sub={tracked ? n.openRate : ""} />
        <Tile label="Clicked" value={tracked ? n.clicked.toLocaleString() : "—"} sub={tracked ? n.clickRate : ""} tone="good" />
        <Tile label="Bounced" value={tracked ? n.bounced.toLocaleString() : "—"} sub={tracked && n.bounced ? pct(n.bounced, n.sent) : ""} tone={n.bounced ? "warn" : ""} />
        <Tile label="Marked as spam" value={tracked ? n.complained.toLocaleString() : "—"} tone={n.complained ? "warn" : ""} />
      </div>
      {!tracked && (
        <p className="legalNote" style={{ marginTop: 10 }}>
          {detail && !detail.tracking
            ? "Opens and clicks aren't set up yet. See Email settings → Opens and clicks."
            : n.sent
              ? "The mail service hasn't reported anything for this email. It was sent before opens and clicks were set up, or tracking isn't connected yet (Email settings → Opens and clicks)."
              : "Nothing has been sent yet."}
        </p>
      )}
      {tracked && (
        <p className="legalNote" style={{ marginTop: 10 }}>
          Opened and clicked are out of the emails delivered. Opens run high: iPhone Mail loads every email in the
          background, which counts as an open. Clicks are the number to trust.
        </p>
      )}

      <h3 className="subhead" style={{ marginTop: 22 }}>
        Came in afterward
      </h3>
      {!results ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="emTiles three">
            <Tile label={`Customers in within ${WINDOW_DAYS} days`} value={results.people.toLocaleString()} sub={results.emailed ? `${pct(results.people, results.emailed)} of ${results.emailed.toLocaleString()} emailed` : ""} tone="good" />
            <Tile label="Tickets" value={results.tickets.toLocaleString()} />
            <Tile label="Sales" value={fmtMoney(results.sales)} sub={results.clickedPeople ? `${fmtMoney(results.clickedSales)} from ${results.clickedPeople} who clicked` : ""} />
          </div>
          <p className="legalNote" style={{ marginTop: 10 }}>
            From your own tickets: customers with an invoice in the {WINDOW_DAYS} days after their copy went out
            {results.open ? ". The window is still open, so this can grow" : ""}. It shows who came in after the
            email, not that the email is why. Some would have come in anyway.
          </p>
          {results.visits.length > 0 && (
            <div className="tableCard" style={{ marginTop: 10 }}>
              <table className="dk">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>First visit after</th>
                    <th>Email</th>
                    <th className="r">Tickets</th>
                    <th className="r">Sales</th>
                  </tr>
                </thead>
                <tbody>
                  {results.visits.slice(0, 25).map((v) => (
                    <tr key={v.customerId}>
                      <td>
                        <b>{v.name}</b>
                      </td>
                      <td className="muted">{fmtDate(v.first)}</td>
                      <td className="muted">{v.clicked ? "Clicked" : v.opened ? "Opened" : "No open recorded"}</td>
                      <td className="r num">{v.tickets}</td>
                      <td className="r num">{fmtMoney(v.sales)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {results.visits.length > 25 && <p className="muted" style={{ margin: "8px 14px" }}>And {results.visits.length - 25} more.</p>}
            </div>
          )}
        </>
      )}

      {tracked && (
        <>
          <h3 className="subhead" style={{ marginTop: 22 }}>
            What they clicked
          </h3>
          {links.length ? (
            <div className="tableCard">
              <table className="dk">
                <thead>
                  <tr>
                    <th>Link</th>
                    <th className="r">People</th>
                    <th className="r">Clicks</th>
                  </tr>
                </thead>
                <tbody>
                  {links.map((l) => (
                    <tr key={l.url}>
                      <td>
                        <b>{l.label}</b>
                        <span className="sub muted" style={{ wordBreak: "break-all" }}>{l.url.length > 90 ? `${l.url.slice(0, 90)}…` : l.url}</span>
                      </td>
                      <td className="r num">{l.people}</td>
                      <td className="r num">{l.clicks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">{rows ? "No clicks yet." : "Loading…"}</p>
          )}

          <h3 className="subhead" style={{ marginTop: 22 }}>
            Who
          </h3>
          <div className="rowBtns" style={{ alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
            <div className="seg">
              {GROUPS.map(([k, l]) => (
                <button key={k} className={group === k ? "on" : ""} onClick={() => setGroup(k)}>
                  {l}
                  {rows ? ` (${recipientsWho(rows, k).length})` : ""}
                </button>
              ))}
            </div>
            {onFollowUp && people.length > 0 && group !== "bounced" && group !== "complained" && (
              <button className="btn tiny primary" onClick={() => onFollowUp(`${groupLabel === "Didn't open" ? "Didn't open" : groupLabel} "${title}"`, people.map((r) => r.email))}>
                Write to these {people.length.toLocaleString()}
              </button>
            )}
          </div>
          {people.length ? (
            <div className="tableCard">
              <table className="dk">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Name</th>
                    <th className="r">Opens</th>
                    <th className="r">Clicks</th>
                  </tr>
                </thead>
                <tbody>
                  {people.slice(0, 100).map((r) => (
                    <tr key={r.id || r.email}>
                      <td>{r.email}</td>
                      <td className="muted">{nameOf(r.email)}</td>
                      <td className="r num">{r.open_count || 0}</td>
                      <td className="r num">{r.click_count || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {people.length > 100 && <p className="muted" style={{ margin: "8px 14px" }}>Showing the first 100 of {people.length.toLocaleString()}.</p>}
            </div>
          ) : (
            <p className="muted">{rows ? "No one yet." : "Loading…"}</p>
          )}
          {(group === "bounced" || group === "complained") && people.length > 0 && (
            <p className="legalNote" style={{ marginTop: 8 }}>
              {group === "bounced" ? "Addresses that bounced for good" : "People who marked it as spam"} are taken off your list automatically and won't be emailed again.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
