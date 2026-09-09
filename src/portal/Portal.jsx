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
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setUser(data.session ? data.session.user : null));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      setUser(s ? s.user : null);
    });
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
  if (recovery) return <NewPassword onDone={() => setRecovery(false)} />;

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
  const [mode, setMode] = useState("signin"); // signin | create | link | forgot
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState("");
  const [busy, setBusy] = useState(false);
  const here = window.location.href.split("#")[0];
  const clean = () => email.trim().toLowerCase();

  const run = async (fn) => {
    setBusy(true);
    onErr("");
    try {
      await fn();
    } catch (e) {
      onErr(friendly(e.message));
    } finally {
      setBusy(false);
    }
  };
  const signIn = () =>
    run(async () => {
      const { error } = await supabase.auth.signInWithPassword({ email: clean(), password });
      if (error) throw error;
    });
  const create = () =>
    run(async () => {
      if (password.length < 8) throw new Error("Use at least 8 characters for the password.");
      const { data, error } = await supabase.auth.signUp({ email: clean(), password, options: { emailRedirectTo: here } });
      if (error) throw error;
      if (!data.session) setSent("confirm");
    });
  const link = () =>
    run(async () => {
      const { error } = await supabase.auth.signInWithOtp({ email: clean(), options: { emailRedirectTo: here } });
      if (error) throw error;
      setSent("link");
    });
  const forgot = () =>
    run(async () => {
      const { error } = await supabase.auth.resetPasswordForEmail(clean(), { redirectTo: here });
      if (error) throw error;
      setSent("reset");
    });
  const submit = { signin: signIn, create, link, forgot }[mode];
  const title = { signin: "Sign in", create: "Create your account", link: "Email me a sign-in link", forgot: "Reset your password" }[mode];

  return (
    <div className="root">
      <div className="pt ptLogin">
        <div className="ptCard">
          <h2>My garage</h2>
          <p className="ptSub">Your vehicles, what's due, your service history, and prices.</p>
          {sent ? (
            <p style={{ marginTop: 16 }}>
              {sent === "confirm" && "Check your email to confirm your account, then come back and sign in."}
              {sent === "link" && "Check your email for a sign-in link. It works on this device or your phone."}
              {sent === "reset" && "Check your email for a link to set a new password."}
            </p>
          ) : (
            <>
              <div className="ptTabs" style={{ marginTop: 14 }}>
                <button className={`btn ${mode === "signin" ? "primary" : ""}`} onClick={() => setMode("signin")}>
                  Sign in
                </button>
                <button className={`btn ${mode === "create" ? "primary" : ""}`} onClick={() => setMode("create")}>
                  Create account
                </button>
              </div>
              <label className="fld">
                <span>Email (the one the shop has for you)</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoFocus autoCapitalize="none" />
              </label>
              {(mode === "signin" || mode === "create") && (
                <label className="fld">
                  <span>{mode === "create" ? "Choose a password (8+ characters)" : "Password"}</span>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && email && password && submit()} />
                </label>
              )}
              {err && <p className="fldErr">{err}</p>}
              <button className="btn primary lg full" disabled={busy || !email || ((mode === "signin" || mode === "create") && !password)} onClick={submit}>
                {busy ? "Working…" : title}
              </button>
              <p className="ptFoot" style={{ marginTop: 16 }}>
                {mode === "signin" && (
                  <>
                    <button className="linkish" onClick={() => setMode("forgot")}>
                      Forgot password
                    </button>
                    {" · "}
                    <button className="linkish" onClick={() => setMode("link")}>
                      Email me a sign-in link instead
                    </button>
                  </>
                )}
                {mode !== "signin" && (
                  <button className="linkish" onClick={() => setMode("signin")}>
                    Back to sign in
                  </button>
                )}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function friendly(msg) {
  const m = String(msg || "");
  if (/invalid login credentials/i.test(m)) return "That email and password don't match. Try Forgot password if you're not sure.";
  if (/already registered/i.test(m)) return "There's already an account for that email. Sign in, or use Forgot password.";
  if (/email not confirmed/i.test(m)) return "Confirm your email first — check your inbox for the confirmation link.";
  if (/rate limit/i.test(m)) return "Too many tries in a row. Give it a minute and try again.";
  return m;
}

/* After a password-reset link, Supabase signs the person in and tells
   us; ask for the new password before showing anything else. */
function NewPassword({ onDone }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="root">
      <div className="pt ptLogin">
        <div className="ptCard">
          <h2>Set a new password</h2>
          <label className="fld" style={{ marginTop: 14 }}>
            <span>New password (8+ characters)</span>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
          </label>
          {err && <p className="fldErr">{err}</p>}
          <button
            className="btn primary lg full"
            disabled={busy || pw.length < 8}
            onClick={async () => {
              setBusy(true);
              const { error } = await supabase.auth.updateUser({ password: pw });
              setBusy(false);
              if (error) setErr(error.message);
              else onDone();
            }}
          >
            Save password
          </button>
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
