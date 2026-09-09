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
      /* only the record carrying this login's email — the database rule
         already limits customers to that, but shop staff can read every
         row, and the portal should never act as a browser of all of them */
      const { data, error } = await supabase
        .from("customer_portal")
        .select("shop_id, customer_id, data, updated_at")
        .ilike("email", String(user.email || "").trim());
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
        {[...new Set(rows.map((r) => r.shop_id))].map((sid) => (
          <ShopSection key={sid} rows={rows.filter((r) => r.shop_id === sid)} shop={shops[sid]} user={user} />
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

/* One garage per shop: every customer record carrying this email is
   folded into a single list of cars. */
function ShopSection({ rows, shop, user }) {
  const shopId = rows[0].shop_id;
  const [hidden, setHidden] = useState([]); // vehicle ids the customer asked to drop
  useEffect(() => {
    supabase
      .from("portal_requests")
      .select("vehicle_id")
      .eq("shop_id", shopId)
      .then(({ data }) => setHidden((data || []).map((r) => r.vehicle_id).filter(Boolean)));
  }, [shopId]);
  const all = rows.flatMap((r) => ((r.data && r.data.vehicles) || []).map((x) => ({ ...x, customerId: r.customer_id })));
  const vehs = all.filter((x) => !hidden.includes(x.id));
  const names = [...new Set(rows.map((r) => r.data && r.data.name).filter(Boolean))];
  const d = { name: names.length === 1 ? names[0] : "" };
  const [carId, setCarId] = useState("");
  const [section, setSection] = useState("due");
  const [dropping, setDropping] = useState(false);
  const v = vehs.find((x) => x.id === carId) || vehs[0];

  const drop = async (kind) => {
    if (!v) return;
    const { error } = await supabase.from("portal_requests").insert({
      shop_id: shopId,
      customer_id: v.customerId,
      email: user.email,
      vehicle_id: v.id,
      kind,
    });
    if (error) return alert("Couldn't send that right now. Please call the shop.");
    setHidden([...hidden, v.id]);
    setCarId("");
    setDropping(false);
  };
  const sections = [
    ["due", "Recommended services"],
    ["receipts", "My receipts"],
    ["call", "Call / Directions"],
    ["ask", "Ask a question"],
  ];
  return (
    <>
      <div className="ptHead">
        {shop && shop.logo ? <img src={shop.logo} alt="" /> : null}
        <div>
          <h1>{shop ? shop.name : "Your shop"}</h1>
          <p>{d.name ? `Welcome back, ${d.name.split(" ")[0]}` : ""}</p>
        </div>
      </div>

      <div className="ptCard ptPick">
        <label className="fld" style={{ margin: 0 }}>
          <span>My cars</span>
          {vehs.length ? (
            <select value={carId} onChange={(e) => setCarId(e.target.value)}>
              {vehs.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                  {x.plate ? ` · ${x.plate}` : ""}
                </option>
              ))}
            </select>
          ) : (
            <p className="ptSub">No cars on file yet.</p>
          )}
        </label>
        {v && (
          <p className="ptSub" style={{ marginTop: 8 }}>
            {[fmtMiles(v.mileage) && `Last mileage ${fmtMiles(v.mileage)}`, v.oil ? `Oil ${v.oil.grade}, ${v.oil.quarts} qt` : ""].filter(Boolean).join(" · ")}
            {" · "}
            <button className="linkish" onClick={() => setDropping(true)}>
              Not my car, or sold it?
            </button>
          </p>
        )}
        {dropping && v && (
          <div className="ptDrop">
            <p className="ptSub">Remove {v.name} from your garage. The shop is told, and it stays in the shop's records.</p>
            <div className="ptCall" style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => drop("sold")}>
                I sold this car
              </button>
              <button className="btn" onClick={() => drop("not_mine")}>
                This was never my car
              </button>
              <button className="btn ghost" onClick={() => setDropping(false)}>
                Keep it
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="ptTabs">
        {sections.map(([k, label]) => (
          <button key={k} className={`btn ${section === k ? "primary" : ""}`} onClick={() => setSection(k)}>
            {label}
          </button>
        ))}
      </div>

      {section === "due" && <DueSection v={v} shop={shop} />}
      {section === "receipts" && <ReceiptsSection v={v} />}
      {section === "call" && <CallSection shop={shop} />}
      {section === "ask" && <AskSection v={v} shop={shop} />}
    </>
  );
}

function DueSection({ v, shop }) {
  if (!v) return <div className="ptCard"><p className="ptSub">Pick a car above.</p></div>;
  return (
    <div className="ptCard">
      <h2>Recommended services</h2>
      <p className="ptSub">Based on your last visits and the shop's service intervals.</p>
      {v.due && v.due.length ? (
        <ul className="ptDue" style={{ marginTop: 12 }}>
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
        <p className="ptSub" style={{ marginTop: 12 }}>
          Nothing on the schedule yet. It fills in after your first service here.
        </p>
      )}
      {v.oilQuote && <div className="ptQuote">Oil change for this car: {fmtMoney(v.oilQuote.total)} out the door</div>}
      {shop && shop.menu && shop.menu.length > 0 && (
        <>
          <h3>Prices</h3>
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
        </>
      )}
    </div>
  );
}

function ReceiptsSection({ v }) {
  if (!v) return <div className="ptCard"><p className="ptSub">Pick a car above.</p></div>;
  return (
    <div className="ptCard">
      <h2>My receipts</h2>
      {v.history && v.history.length ? (
        <ul className="ptHist" style={{ marginTop: 8 }}>
          {v.history.map((h) => (
            <li key={h.number}>
              <div className="top">
                <span>
                  {fmtDate(h.date)}
                  {h.miles ? ` · ${fmtMiles(h.miles)}` : ""}
                  <small style={{ color: "var(--muted)" }}> · Invoice #{h.number}</small>
                </span>
                <strong>{fmtMoney(h.total)}</strong>
              </div>
              <div className="work">{h.work.map((w) => (w.qty && w.qty !== 1 ? `${w.qty}× ${w.text}` : w.text)).join(" · ")}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ptSub" style={{ marginTop: 8 }}>
          No visits on record for this car.
        </p>
      )}
    </div>
  );
}

function CallSection({ shop }) {
  const phone = shop && shop.phone ? String(shop.phone).replace(/\D/g, "") : "";
  const addr = shop && shop.address ? shop.address : "";
  return (
    <div className="ptCard">
      <h2>{shop ? shop.name : "The shop"}</h2>
      {shop && shop.hours ? <p className="ptSub">{shop.hours}</p> : null}
      <div className="ptCall">
        {phone ? (
          <a className="btn primary lg" href={`tel:${phone}`}>
            Call {shop.phone}
          </a>
        ) : null}
        {addr ? (
          <a className="btn lg" href={`https://maps.apple.com/?q=${encodeURIComponent(addr)}`} target="_blank" rel="noreferrer">
            Directions
          </a>
        ) : null}
        {shop && shop.email ? (
          <a className="btn lg" href={`mailto:${shop.email}`}>
            Email the shop
          </a>
        ) : null}
      </div>
      {addr ? <p className="ptSub" style={{ marginTop: 12 }}>{addr}</p> : null}
    </div>
  );
}

/* Questions about services, answered by the shop's helper (an Edge
   Function that knows this car and the shop's prices). */
function AskSection({ v, shop }) {
  const [msgs, setMsgs] = useState([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const send = async () => {
    const question = q.trim();
    if (!question || busy) return;
    setQ("");
    setErr("");
    const next = [...msgs, { role: "user", content: question }];
    setMsgs(next);
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("portal-chat", {
      body: { question, history: msgs.slice(-10), vehicleId: v ? v.id : null },
    });
    setBusy(false);
    if (error || !data || data.error) {
      setErr((data && data.error) || "The helper isn't available right now. Call the shop and they'll help.");
      return;
    }
    setMsgs([...next, { role: "assistant", content: data.answer }]);
  };
  const starters = ["What does a brake fluid flush do?", "Why is my oil change due by date and not just miles?", "What's included in the tire mount package?"];
  return (
    <div className="ptCard">
      <h2>Ask a question</h2>
      <p className="ptSub">About services, what they're for, or what's due{v ? ` on your ${v.name}` : ""}. For anything urgent, call the shop.</p>
      <div className="ptChat">
        {msgs.length === 0 && (
          <div className="ptStarters">
            {starters.map((t) => (
              <button key={t} className="btn tiny" onClick={() => setQ(t)}>
                {t}
              </button>
            ))}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`ptMsg ${m.role}`}>
            {m.content}
          </div>
        ))}
        {busy && <div className="ptMsg assistant muted">Thinking…</div>}
        {err && <p className="fldErr">{err}</p>}
      </div>
      <div className="ptAsk">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type your question" onKeyDown={(e) => e.key === "Enter" && send()} />
        <button className="btn primary" disabled={busy || !q.trim()} onClick={send}>
          Ask
        </button>
      </div>
      <p className="ptSub" style={{ marginTop: 10, fontSize: 12 }}>
        General guidance, not a diagnosis. Prices other than those listed come from the shop.
      </p>
    </div>
  );
}
