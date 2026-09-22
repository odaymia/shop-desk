/* Card payments through Stripe Connect.

   Bolt Badger is the platform; each shop is a connected (Express) account.
   A card sale is created as a DESTINATION CHARGE on the platform: the funds
   are routed to the shop (on_behalf_of, so the shop is the merchant of record
   and its name is on the statement) and we keep an application fee — our cut —
   on every swipe. One platform key, one webhook.

   Two ways to take a card:
     - reader:  a registered internet reader at the counter (WisePOS E / S700).
                The "pay" Edge Function drives it server-side, so there is no
                fragile browser SDK to babysit.
     - link:    a Stripe Checkout link texted to the customer (card-not-present,
                pairs with remote signing). A webhook marks the ticket paid.

   Everything goes through the "pay" Edge Function, which holds the secret key;
   the browser never sees it. When Stripe isn't set up yet (demo, or before the
   platform account is wired) the function SIMULATES success so the whole flow
   can be built, demoed, and trained on — the same convention as tire-search
   and sign. `simulated: true` comes back so the UI can say so.

   The fee math below is pure and tested (tests/payments.test.js). Keep it that
   way — this module must stay import-safe outside the browser, so the network
   wrappers load the storage/cloud module lazily instead of at the top. */
import { round2 } from "./invoice.js";

/* The cloud module reaches for `window`, so pull it in only when a wrapper is
   actually called (never during a Node test that just imports the fee math).

   In demo or when the device is offline there is no backend, so we SIMULATE the
   same shapes the "pay" function returns in its own simulated mode — this is
   how the demo takes a "card" and how the flow works before the function is
   deployed. When the device is live, real errors from the function propagate so
   the desk shows them ("Connect the shop to Stripe first", etc.). */
async function offline() {
  try {
    const [{ cloud }, { DEMO }] = await Promise.all([import("../storage/index.js"), import("./demo.js")]);
    if (DEMO) return true;
    const s = cloud.getState ? cloud.getState() : {};
    return !(s.linked && s.online);
  } catch {
    return true;
  }
}
function simulate(body) {
  const a = body.action;
  if (a === "connect-link") return { url: body.returnUrl || "#", accountId: "acct_simulated", simulated: true };
  if (a === "connect-status") return { accountId: "acct_simulated", chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, simulated: true };
  if (a === "readers") return { readers: [{ id: "tmr_simulated", label: "Front counter (simulated)", status: "online" }], simulated: true };
  if (a === "register-reader") return { reader: { id: "tmr_simulated", label: body.label || "Front counter (simulated)", status: "online" }, simulated: true };
  if (a === "reader-charge") return { paymentIntentId: `pi_sim_${Math.random().toString(36).slice(2, 10)}`, status: "processing", simulated: true };
  if (a === "charge-status") return { status: "succeeded", cardBrand: "Visa", last4: "4242", simulated: true };
  if (a === "cancel-charge") return { ok: true, simulated: true };
  if (a === "pay-link") return { url: "#pay-demo", sent: false, simulated: true };
  return { simulated: true };
}
async function pay(body) {
  if (await offline()) return simulate(body);
  const { cloud } = await import("../storage/index.js");
  return cloud.invoke("pay", body);
}

/* Our platform markup — what Bolt Badger keeps on each card sale, on top of
   Stripe's own processing cost. This is a product-level number set centrally,
   not something an individual shop can turn down. A deployment can override it
   with cfg.payments.{platformFeePct,platformFeeFixed}; the default lives here
   so the math is testable and there is always a sane value. */
export const DEFAULT_PLATFORM_FEE = { pct: 0.3, fixed: 0 }; // 0.3% + $0.00

export function platformFeeCfg(cfg) {
  const p = (cfg && cfg.payments) || {};
  const n = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    pct: Math.max(0, n(p.platformFeePct, DEFAULT_PLATFORM_FEE.pct)),
    fixed: Math.max(0, n(p.platformFeeFixed, DEFAULT_PLATFORM_FEE.fixed)),
  };
}

/* Our application fee on a given sale, in dollars. Never negative, never more
   than the sale itself (a refund or a $0 line yields $0). */
export function platformFee(amount, cfg) {
  const amt = round2(amount);
  if (!(amt > 0)) return 0;
  const { pct, fixed } = platformFeeCfg(cfg);
  return round2(Math.min(amt, (amt * pct) / 100 + fixed));
}

/* Stripe works in the smallest currency unit (cents for USD). */
export const toCents = (dollars) => Math.round((Number(dollars) || 0) * 100);
export const fromCents = (cents) => round2((Number(cents) || 0) / 100);

/* ---- thin wrappers over the "pay" Edge Function ------------------------- */

/* Onboarding: get (creating if needed) the shop's Express account and a link
   to finish Stripe's sign-up. Returns { url, accountId }. */
export async function connectLink(returnUrl) {
  return pay({ action: "connect-link", returnUrl });
}

/* Where the shop's account stands: { accountId, chargesEnabled, payoutsEnabled,
   detailsSubmitted, simulated }. Safe to call anytime; returns nulls when the
   shop hasn't started onboarding. */
export async function connectStatus() {
  return pay({ action: "connect-status" });
}

/* Registered counter readers for this shop: [{ id, label, status }]. */
export async function listReaders() {
  return pay({ action: "readers" });
}

/* Pair a new internet reader using the code shown on the device. */
export async function registerReader(code, label) {
  return pay({ action: "register-reader", code, label });
}

/* Charge a card on a counter reader. Creates the destination charge with our
   application fee and tells the reader to collect. Returns
   { paymentIntentId, status, simulated }. Poll chargeStatus until it settles. */
export async function chargeOnReader({ orderId, readerId, amount, cfg }) {
  return pay({
    action: "reader-charge",
    orderId,
    readerId,
    amountCents: toCents(amount),
    feeCents: toCents(platformFee(amount, cfg)),
  });
}

/* How a reader charge is going: { status, cardBrand, last4, simulated }.
   status is one of requires_action | processing | succeeded | canceled. */
export async function chargeStatus(paymentIntentId) {
  return pay({ action: "charge-status", paymentIntentId });
}

/* Cancel an in-progress reader collection (customer walked away, wrong amount). */
export async function cancelReaderCharge(paymentIntentId, readerId) {
  return pay({ action: "cancel-charge", paymentIntentId, readerId });
}

/* Text-to-pay: create a Checkout link for the balance and (if Twilio is set)
   text it to the customer. Returns { url, sent, simulated }. The webhook marks
   the ticket paid when the customer completes it. */
export async function sendPayLink({ orderId, amount, phone, cfg }) {
  return pay({
    action: "pay-link",
    orderId,
    amountCents: toCents(amount),
    feeCents: toCents(platformFee(amount, cfg)),
    phone,
  });
}

/* Build the payment record that goes onto the ticket after a successful card
   charge, matching the shape the manual "Record a payment" flow already uses
   (invoice.js paymentDesc reads .method/.cardType/.ref). `fee` is our cut,
   kept for the payments report; it is metadata and never changes the balance. */
export function cardPaymentRecord({ amount, cardType, last4, fee, paymentIntentId, simulated }) {
  return {
    method: "card",
    processor: "stripe",
    amount: round2(amount),
    cardType: cardType || "Card",
    ref: last4 || "",
    fee: round2(fee || 0),
    piId: paymentIntentId || "",
    simulated: !!simulated,
  };
}

/* This shop's card totals across its own tickets, for the Payments report:
   { count, gross, fees }. gross is what customers paid by card; fees is our
   platform cut (what Bolt Badger earned on this shop). The true cross-shop
   platform revenue lives in the Stripe dashboard. */
export function cardPaymentStats(orders) {
  let count = 0;
  let gross = 0;
  let fees = 0;
  for (const o of orders || []) {
    for (const p of o.payments || []) {
      if (p.method !== "card" || p.processor !== "stripe") continue;
      count += 1;
      gross = round2(gross + (Number(p.amount) || 0));
      fees = round2(fees + (Number(p.fee) || 0));
    }
  }
  return { count, gross, fees };
}
