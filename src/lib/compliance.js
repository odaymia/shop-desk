/* BAR "Write It Right" compliance helpers — pure, no React or storage.
   Covers: recording how/when a repair was authorized, catching when the total
   has grown past what the customer approved (a top BAR violation), the EPA ID
   a hazardous-waste disposal fee must carry, and a soft pre-post checklist. */

const CENT = 0.005;

/* A fee line that is a hazardous-waste / disposal fee (needs an EPA ID). */
export function isHazmatFee(line) {
  return !!line && line.kind === "fee" && /hazard|hazmat|disposal|toxic|\bepa\b|waste|environmental/i.test(String(line.description || ""));
}

/* How authorization was obtained, as it reads on the paperwork. */
export function methodPhrase(method) {
  return { "in-person": "in person", phone: "by phone", text: "by text message", electronic: "electronically", email: "by email" }[method] || String(method || "");
}

/* The printable authorization-record sentence. `fmtWhen` formats the timestamp
   (passed in so this stays pure/testable). */
export function authRecordText(auth, fmtWhen = (t) => String(t)) {
  if (!auth || !String(auth.name || "").trim()) return "";
  let s = `Authorized by ${String(auth.name).trim()}`;
  const mp = methodPhrase(auth.method);
  if (mp) s += ` ${mp}`;
  if (auth.at) s += ` on ${fmtWhen(auth.at)}`;
  if (auth.contact) s += ` (${String(auth.contact).trim()})`;
  if (auth.advisor) s += `; recorded by ${String(auth.advisor).trim()}`;
  return s.replace(/[.\s]+$/, "") + ".";
}

/* The additional-authorization sentence for work added after the first
   approval. */
export function reauthText(r, fmtWhen = (t) => String(t)) {
  if (!r) return "";
  const base = authRecordText(r, fmtWhen).replace(/^Authorized/, "Additional work authorized");
  const note = String(r.note || "").trim();
  const totals = r.newTotal != null ? ` Revised total: ${fmtMoney(r.newTotal)}.` : "";
  return `${base}${note ? ` ${note.replace(/[.\s]*$/, "")}.` : ""}${totals}`;
}

/* fmtMoney kept local so this module has no UI deps. */
function fmtMoney(n) {
  const v = Number(n) || 0;
  return `$${v.toFixed(2)}`;
}

/* Has the customer authorized this ticket at all (a signature or a recorded
   oral/electronic authorization)? */
export function isAuthorized(order) {
  const sig = order && order.signatures && order.signatures.authorization;
  return !!(sig && sig.img) || !!(order && order.auth && order.auth.name);
}

/* The total the customer approved (0 if never captured). */
export function authorizedTotal(order) {
  const n = Number(order && order.authorizedTotal);
  return Number.isFinite(n) ? n : null;
}

/* True when there's an authorization on record and the current total has grown
   past it — the customer approved less than what's now on the ticket. */
export function needsReauth(order, currentTotal) {
  const authd = authorizedTotal(order);
  if (authd == null) return false;
  return Number(currentTotal) > authd + CENT;
}

/* Soft warnings to show before posting an invoice — never blocks, just flags
   the common BAR gaps so the writer can fix or knowingly proceed. */
export function complianceWarnings(order, cfg, total) {
  const w = [];
  if (!isAuthorized(order)) w.push("No customer authorization is on record (no signature or recorded phone/electronic approval).");
  if (needsReauth(order, total)) {
    const authd = authorizedTotal(order);
    w.push(`The total (${fmtMoney(total)}) is above what the customer authorized (${fmtMoney(authd)}). Record the customer's approval for the additional work.`);
  }
  const hasHazmat = (order.lines || []).some(isHazmatFee);
  if (hasHazmat && !String((cfg && cfg.epaId) || "").trim()) w.push("A hazardous-waste disposal fee is charged, but no EPA ID is set (Settings → Company info).");
  return w;
}
