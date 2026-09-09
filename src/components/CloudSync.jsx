import { useState } from "react";
import { useCloud } from "../hooks/useCloud.js";
import { cloud } from "../storage/index.js";
import { fmtTime } from "../lib/time.js";

/* Sign in / status panel for cloud sync. Used in Settings and, in compact
   form, on the first-run Setup screen for a second device. */
export function CloudSync({ compact }) {
  const s = useCloud();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  if (!s.configured) return <p className="muted">Cloud sync isn't set up in this build.</p>;

  const run = async (fn) => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await fn();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  if (s.needsSignIn) {
    return (
      <div className="cloudBox">
        <p className="fldErr">{s.error || "Your sign-in expired."}</p>
        <p className="muted">
          Sign in again with the shop account. {s.pending ? `${s.pending} waiting change${s.pending === 1 ? "" : "s"} upload right after.` : ""}
        </p>
        <label className="fld">
          <span>Email</span>
          <input type="email" autoCapitalize="none" autoCorrect="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={s.user ? s.user.email : "you@example.com"} />
        </label>
        <label className="fld">
          <span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {err && <p className="fldErr">{err}</p>}
        <div className="fldRow">
          <button className="btn primary" disabled={busy || !password} onClick={() => run(() => cloud.signIn((email || (s.user && s.user.email) || "").trim(), password))}>
            {busy ? "Working…" : "Sign in"}
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => run(() => cloud.signOut())}>
            Sign out instead
          </button>
        </div>
      </div>
    );
  }

  if (s.user && s.shopId) {
    return (
      <div className="cloudBox">
        <p>
          <strong>Signed in</strong> as {s.user.email} · shop “{s.shopName}”
        </p>
        <p className="muted">
          {s.online ? "Online" : "Offline"} ·{" "}
          {s.pending
            ? `${s.pending} change${s.pending === 1 ? "" : "s"} waiting to upload`
            : "Everything uploaded"}{" "}
          · {s.lastSync ? `last checked ${fmtTime(new Date(s.lastSync))}` : "not synced yet"}
        </p>
        {s.error && <p className="fldErr">{s.error}</p>}
        <div className="fldRow">
          <button className="btn" onClick={() => cloud.syncNow()} disabled={s.syncing}>
            {s.syncing ? "Syncing…" : "Sync now"}
          </button>
          <button
            className="btn ghost"
            disabled={busy}
            title={s.pending > 0 ? "Waiting changes stay on this computer and upload after the next sign-in" : ""}
            onClick={() => run(() => cloud.signOut())}
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (s.user && !s.shopId) {
    return (
      <div className="cloudBox">
        <p>Signed in as {s.user.email}, but not connected to a shop yet.</p>
        {err && <p className="fldErr">{err}</p>}
        <div className="fldRow">
          <button className="btn primary" disabled={busy} onClick={() => run(() => cloud.linkShop())}>
            Connect this device
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => run(() => cloud.signOut())}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="cloudBox">
      {!compact && (
        <p className="muted">
          Sign in with the same account the time clock uses. This desk then shares the shop's
          staff list with the clock, and every computer you sign in on sees the same customers,
          tickets, and inventory.
        </p>
      )}
      <label className="fld">
        <span>Email</span>
        <input
          type="email"
          autoCapitalize="none"
          autoCorrect="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </label>
      <label className="fld">
        <span>Password</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 6 characters"
        />
      </label>
      {err && <p className="fldErr">{err}</p>}
      {msg && <p className="muted">{msg}</p>}
      <div className="fldRow">
        <button
          className="btn primary"
          disabled={busy || !email || !password}
          onClick={() => run(() => cloud.signIn(email.trim(), password))}
        >
          {busy ? "Working…" : "Sign in"}
        </button>
        <button
          className="btn"
          disabled={busy || !email || !password}
          onClick={() =>
            run(async () => {
              const r = await cloud.signUp(email.trim(), password);
              if (r === "confirm")
                setMsg("Check your email for a confirmation link, then come back and tap Sign in.");
            })
          }
        >
          Create account
        </button>
      </div>
    </div>
  );
}
