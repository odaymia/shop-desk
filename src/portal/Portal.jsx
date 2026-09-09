import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../lib/cloudConfig.js";
import { fmtMoney } from "../lib/invoice.js";

/* The customer's side. Sign in with a link to your email, see your cars,
   what's due, what was done, and the shop's prices. Reads two tables the
   shop publishes; the database only hands back rows that carry the
   signed-in email. */

const supabase = SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const fmtDate = (ts) => (ts ? new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");
const fmtMiles = (n) => (n ? `${Number(n).toLocaleString()} mi` : "");

export default function Portal() {
  const [user, setUser] = useState(undefined);
  const [rows, setRows] = useState([]);
  const [shops, setShops] = useState({});
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setUser(data.session ? data.session.user : null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setUser(s ? s.user : null));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data, error } = await supabase.from("customer_portal").select("shop_id, customer_id, data, updated_at");
      if (error) return setErr(error.message);
      setRows(data || []);
      const ids = [...new Set((data || []).map((r) => r.shop_id))];
      if (ids.length) {
        const { data: sp } = await supabase.from("shop_public").select("shop_id, data").in("shop_id", ids);
        const m = {};
        for (const r of sp || []) m[r.shop_id] = r.data;
        setShops(m);
      }
    })();
  }, [user]);

  if (!supabase) return <div className="root pt">This portal isn't connected to a shop yet.</div>;
  if (user === undefined) return <div className="root pt" />;
  if (!user) return <Login onErr={setErr} err={err} />;

  return (
    <div className="root">
      <div className="pt">
        {rows.length === 0 && (
          <div className="ptCard">
            <h2>Nothing here yet</h2>
            <p className="ptSub">
              We don't have a vehicle on file under {user.email}. If you've been in before, ask the shop to add this email to
              your account.
            </p>
          </div>
        )}
        {rows.map((r) => (
          <ShopSection key={r.shop_id + r.customer_id} row={r} shop={shops[r.shop_id]} />
        ))}
        <p className="ptFoot">
          Signed in as {user.email}.{" "}
          <button className="linkish" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </p>
      </div>
    </div>
  );
}

function Login({ err, onErr }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    onErr("");
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { emailRedirectTo: window.location.href.split("#")[0] } });
    setBusy(false);
    if (error) onErr(error.message);
    else setSent(true);
  };
  return (
    <div className="root">
      <div className="pt ptLogin">
        <div className="ptCard">
          <h2>My garage</h2>
          <p className="ptSub">See your vehicles, what's due, your service history, and prices. Enter the email the shop has for you.</p>
          {sent ? (
            <p style={{ marginTop: 16 }}>Check your email for a sign-in link. It works on this device or your phone.</p>
          ) : (
            <>
              <label className="fld" style={{ marginTop: 16 }}>
                <span>Email</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoFocus onKeyDown={(e) => e.key === "Enter" && email && send()} />
              </label>
              {err && <p className="fldErr">{err}</p>}
              <button className="btn primary lg full" disabled={busy || !email} onClick={send}>
                {busy ? "Sending…" : "Email me a sign-in link"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ShopSection({ row, shop }) {
  const d = row.data || {};
  const vehs = d.vehicles || [];
  const [tab, setTab] = useState(0);
  const v = vehs[tab];
  return (
    <>
      <div className="ptHead">
        {shop && shop.logo ? <img src={shop.logo} alt="" /> : null}
        <div>
          <h1>{shop ? shop.name : "Your shop"}</h1>
          <p>
            {[shop && shop.phone, shop && shop.address].filter(Boolean).join(" · ")}
            {shop && shop.hours ? ` · ${shop.hours}` : ""}
          </p>
        </div>
      </div>
      {vehs.length > 1 && (
        <div className="ptTabs">
          {vehs.map((x, i) => (
            <button key={x.id} className={`btn ${i === tab ? "primary" : ""}`} onClick={() => setTab(i)}>
              {x.name}
            </button>
          ))}
        </div>
      )}
      {v && (
        <>
          <div className="ptCard">
            <h2>{v.name}</h2>
            <p className="ptSub">
              {[v.plate, fmtMiles(v.mileage), v.oil ? `${v.oil.grade} · ${v.oil.quarts} qt` : ""].filter(Boolean).join(" · ")}
            </p>
            <h3>Coming up</h3>
            {v.due && v.due.length ? (
              <ul className="ptDue">
                {v.due.map((s) => (
                  <li key={s.key} className={s.status}>
                    {s.label}
                    <span>
                      {s.status === "overdue" ? "Due now" : s.status === "soon" ? "Due soon" : "Due"}
                      {s.dueDate ? ` · ${fmtDate(s.dueDate)}` : ""}
                      {s.dueMiles ? ` or ${fmtMiles(s.dueMiles)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ptSub">Nothing on the schedule yet. It fills in after your first service here.</p>
            )}
            {v.oilQuote && (
              <div className="ptQuote">
                Oil change for this car: {fmtMoney(v.oilQuote.total)} out the door
              </div>
            )}
            <h3>Service history</h3>
            {v.history && v.history.length ? (
              <ul className="ptHist">
                {v.history.map((h) => (
                  <li key={h.number}>
                    <div className="top">
                      <span>
                        {fmtDate(h.date)}
                        {h.miles ? ` · ${fmtMiles(h.miles)}` : ""}
                      </span>
                      <strong>{fmtMoney(h.total)}</strong>
                    </div>
                    <div className="work">{h.work.map((w) => (w.qty && w.qty !== 1 ? `${w.qty}× ${w.text}` : w.text)).join(" · ")}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ptSub">No visits on record for this car.</p>
            )}
          </div>
        </>
      )}
      {shop && shop.menu && shop.menu.length > 0 && (
        <div className="ptCard">
          <h2>Prices</h2>
          <ul className="ptMenu">
            {shop.menu.map((m) => (
              <li key={m.name}>
                <div>
                  {m.name}
                  {m.details ? <small>{m.details}</small> : null}
                </div>
                <strong>
                  {fmtMoney(m.price)}
                  {m.per ? ` / ${m.per}` : ""}
                </strong>
              </li>
            ))}
          </ul>
          <p className="ptSub" style={{ marginTop: 10 }}>
            Plus sales tax on parts. Your car's exact price is a phone call away.
          </p>
        </div>
      )}
    </>
  );
}
