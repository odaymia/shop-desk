// Supabase Edge Function: card payments through Stripe Connect.
//
// Bolt Badger is the platform; each shop is a connected (Express) account.
// A card sale is a DESTINATION CHARGE created on the platform: funds are routed
// to the shop (on_behalf_of, so the shop is the merchant of record) and the
// platform keeps an application fee — our cut. The secret key stays here; the
// browser only ever calls this function.
//
// Actions (all POST { action, ... }):
//   connect-link      (auth)  create/return the shop's Express account + a link to finish onboarding
//   connect-status    (auth)  chargesEnabled / payoutsEnabled / detailsSubmitted for the shop
//   readers           (auth)  the shop's registered counter readers
//   register-reader   (auth)  pair an internet reader by its on-device code
//   reader-charge     (auth)  create the destination charge and tell the reader to collect
//   charge-status     (auth)  poll a reader charge until it settles
//   cancel-charge     (auth)  abort an in-progress reader collection
//   pay-link          (auth)  create a Checkout link for the balance and text it (card-not-present)
//   webhook           (public, Stripe-signed) mark a ticket paid when a link/charge succeeds
//
// Deploy: Supabase dashboard -> Edge Functions -> Deploy a new function -> name
// it "pay" -> paste this file. Then add these secrets under Edge Functions ->
// Secrets:
//   STRIPE_SECRET_KEY       your PLATFORM account's secret key (sk_test_... to start)
//   STRIPE_WEBHOOK_SECRET   the signing secret of the webhook endpoint you point at
//                           <project>.functions.supabase.co/pay  (event: checkout.session.completed,
//                           payment_intent.succeeded)
//   APP_BASE_URL            where the desk is hosted (e.g. https://desk.yourshop.com/) — used for
//                           the Checkout success/cancel and onboarding return links
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM   (optional) to text pay links
// Until STRIPE_SECRET_KEY is set the function SIMULATES success so the whole
// flow can be built, demoed, and trained on. Every response carries
// `simulated: true` in that mode so the UI can say so.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPA_URL, SERVICE_KEY);

const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const LIVE = !!STRIPE_KEY;
const APP_BASE = (Deno.env.get("APP_BASE_URL") || "").replace(/\/$/, "");
const digits = (s: string) => String(s || "").replace(/\D/g, "");

/* ---- Stripe REST (no SDK needed in Deno) ------------------------------- */
// Form-encode nested params the way Stripe's API expects (a[b]=c, a[]=b).
function encode(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === "object") out.push(...encode(item as Record<string, unknown>, `${key}[${i}]`));
        else out.push(`${encodeURIComponent(`${key}[]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (v && typeof v === "object") {
      out.push(...encode(v as Record<string, unknown>, key));
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return out;
}
async function stripe(path: string, method: "GET" | "POST", params?: Record<string, unknown>) {
  const url = `https://api.stripe.com/v1/${path}`;
  const body = method === "POST" && params ? encode(params).join("&") : undefined;
  const res = await fetch(method === "GET" && params ? `${url}?${encode(params).join("&")}` : url, {
    method,
    headers: {
      Authorization: `Bearer ${STRIPE_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": "2024-06-20",
    },
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || `Stripe ${res.status}`;
    console.error("stripe error", path, msg);
    throw new Error(msg);
  }
  return data;
}

/* ---- the shop's connected account (kept in stripe_accounts) ------------ */
async function accountFor(shopId: string): Promise<string | null> {
  const { data } = await admin.from("stripe_accounts").select("account_id").eq("shop_id", shopId).maybeSingle();
  return data?.account_id ?? null;
}
async function ensureAccount(shopId: string): Promise<string> {
  const existing = await accountFor(shopId);
  if (existing) return existing;
  const acct = await stripe("accounts", "POST", {
    type: "express",
    capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    metadata: { shop_id: shopId },
  });
  await admin.from("stripe_accounts").upsert({ shop_id: shopId, account_id: acct.id });
  return acct.id;
}

/* ---- Twilio (same pattern as the sign function) ------------------------ */
async function sendSms(to: string, message: string): Promise<boolean> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const auth = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_FROM");
  if (!sid || !auth || !from) return false;
  const d = digits(to);
  const e164 = d.length === 10 ? `+1${d}` : d.startsWith("1") && d.length === 11 ? `+${d}` : `+${d}`;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${sid}:${auth}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: e164, From: from, Body: message }),
  });
  if (!res.ok) console.error("twilio send failed", res.status, await res.text());
  return res.ok;
}

/* ---- write a successful card payment back onto the ticket -------------- */
// Mirrors the desk's own payment shape so it reads the same on the receipt.
async function recordPaymentOnOrder(shopId: string, orderId: string, payment: Record<string, unknown>) {
  const key = `sd:order:${orderId}`;
  const { data: row } = await admin.from("kv").select("value").eq("shop_id", shopId).eq("key", key).maybeSingle();
  if (!row?.value) return;
  const order = row.value as Record<string, unknown>;
  const payments = (order.payments as unknown[]) || [];
  // idempotent: a webhook can fire more than once — don't double-post the same intent
  if (payment.piId && payments.some((p) => (p as Record<string, unknown>).piId === payment.piId)) return;
  order.payments = [...payments, payment];
  order.history = [...((order.history as unknown[]) || []), { at: payment.at, what: `paid card ${(Number(payment.amount) || 0).toFixed(2)} (Stripe)` }];
  await admin.from("kv").upsert({ shop_id: shopId, key, value: order });
}

/* ---- auth: resolve the caller to their shop --------------------------- */
async function shopOf(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const asUser = createClient(SUPA_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await asUser.auth.getUser();
  if (!userData?.user) return null;
  const { data: member } = await asUser.from("shop_members").select("shop_id").limit(1);
  return member?.length ? (member[0].shop_id as string) : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // ---- Stripe webhook: Stripe-signed, no user auth ----
  const sig = req.headers.get("stripe-signature");
  if (sig) return handleWebhook(req, sig);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const action = String(body.action || "");
  const shopId = await shopOf(req);
  if (!shopId) return json({ error: "Sign in first" }, 401);

  try {
    if (action === "connect-link") return await connectLink(shopId, String(body.returnUrl || ""));
    if (action === "connect-status") return await connectStatus(shopId);
    if (action === "readers") return await listReaders(shopId);
    if (action === "register-reader") return await registerReader(shopId, String(body.code || ""), String(body.label || ""));
    if (action === "reader-charge") return await readerCharge(shopId, body);
    if (action === "charge-status") return await chargeStatus(shopId, String(body.paymentIntentId || ""));
    if (action === "cancel-charge") return await cancelCharge(String(body.paymentIntentId || ""), String(body.readerId || ""));
    if (action === "pay-link") return await payLink(shopId, body);
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error(action, e);
    return json({ error: (e as Error).message || "Payment error" }, 400);
  }
});

/* ---- actions ----------------------------------------------------------- */

async function connectLink(shopId: string, returnUrl: string) {
  const ret = returnUrl || `${APP_BASE}/` || "/";
  if (!LIVE) return json({ url: ret, accountId: "acct_simulated", simulated: true });
  const accountId = await ensureAccount(shopId);
  const link = await stripe("account_links", "POST", {
    account: accountId,
    refresh_url: ret,
    return_url: ret,
    type: "account_onboarding",
  });
  return json({ url: link.url, accountId });
}

async function connectStatus(shopId: string) {
  if (!LIVE) return json({ accountId: "acct_simulated", chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, simulated: true });
  const accountId = await accountFor(shopId);
  if (!accountId) return json({ accountId: null, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false });
  const a = await stripe(`accounts/${accountId}`, "GET");
  return json({
    accountId,
    chargesEnabled: !!a.charges_enabled,
    payoutsEnabled: !!a.payouts_enabled,
    detailsSubmitted: !!a.details_submitted,
  });
}

async function listReaders(shopId: string) {
  if (!LIVE) return json({ readers: [{ id: "tmr_simulated", label: "Front counter (simulated)", status: "online" }], simulated: true });
  // Readers are registered on the platform (destination charges route funds to
  // the shop); we tag each with its shop_id and filter here.
  const res = await stripe("terminal/readers", "GET", { limit: 100 });
  const readers = (res.data || [])
    .filter((r: Record<string, unknown>) => (r.metadata as Record<string, unknown>)?.shop_id === shopId)
    .map((r: Record<string, unknown>) => ({ id: r.id, label: r.label || r.device_type, status: r.status }));
  return json({ readers });
}

async function registerReader(shopId: string, code: string, label: string) {
  if (!code) return json({ error: "Enter the pairing code shown on the reader." }, 400);
  if (!LIVE) return json({ reader: { id: "tmr_simulated", label: label || "Front counter (simulated)", status: "online" }, simulated: true });
  const r = await stripe("terminal/readers", "POST", {
    registration_code: code,
    label: label || "Counter reader",
    metadata: { shop_id: shopId },
  });
  return json({ reader: { id: r.id, label: r.label, status: r.status } });
}

async function readerCharge(shopId: string, body: Record<string, unknown>) {
  const amountCents = Math.round(Number(body.amountCents) || 0);
  const feeCents = Math.max(0, Math.min(amountCents, Math.round(Number(body.feeCents) || 0)));
  const readerId = String(body.readerId || "");
  const orderId = String(body.orderId || "");
  if (amountCents <= 0) return json({ error: "Nothing to charge." }, 400);
  if (!readerId) return json({ error: "Pick a reader." }, 400);
  if (!LIVE) return json({ paymentIntentId: `pi_sim_${crypto.randomUUID().slice(0, 8)}`, status: "processing", simulated: true });

  const accountId = await accountFor(shopId);
  if (!accountId) return json({ error: "Connect the shop to Stripe first." }, 400);
  const pi = await stripe("payment_intents", "POST", {
    amount: amountCents,
    currency: "usd",
    payment_method_types: ["card_present"],
    capture_method: "automatic",
    application_fee_amount: feeCents,
    on_behalf_of: accountId,
    transfer_data: { destination: accountId },
    metadata: { shop_id: shopId, order_id: orderId },
  });
  await stripe(`terminal/readers/${readerId}/process_payment_intent`, "POST", { payment_intent: pi.id });
  return json({ paymentIntentId: pi.id, status: "processing" });
}

async function chargeStatus(shopId: string, piId: string) {
  if (!piId) return json({ error: "Missing charge id" }, 400);
  if (!LIVE || piId.startsWith("pi_sim_")) {
    // In simulated mode a charge "settles" on the first poll.
    return json({ status: "succeeded", cardBrand: "Visa", last4: "4242", simulated: true });
  }
  const pi = await stripe(`payment_intents/${piId}`, "GET", { "expand[]": "latest_charge" });
  const charge = pi.latest_charge as Record<string, unknown> | undefined;
  const details = (charge?.payment_method_details as Record<string, unknown>)?.card_present as Record<string, unknown> | undefined;
  return json({
    status: pi.status,
    cardBrand: details?.brand ? cap(String(details.brand)) : "Card",
    last4: details?.last4 ? String(details.last4) : "",
  });
}

async function cancelCharge(piId: string, readerId: string) {
  if (!LIVE || piId.startsWith("pi_sim_")) return json({ ok: true, simulated: true });
  try {
    if (readerId) await stripe(`terminal/readers/${readerId}/cancel_action`, "POST");
  } catch { /* reader may already be idle */ }
  try {
    await stripe(`payment_intents/${piId}/cancel`, "POST");
  } catch { /* already terminal */ }
  return json({ ok: true });
}

async function payLink(shopId: string, body: Record<string, unknown>) {
  const amountCents = Math.round(Number(body.amountCents) || 0);
  const feeCents = Math.max(0, Math.min(amountCents, Math.round(Number(body.feeCents) || 0)));
  const orderId = String(body.orderId || "");
  const phone = digits(String(body.phone || ""));
  if (amountCents <= 0) return json({ error: "Nothing to charge." }, 400);
  if (!LIVE) {
    const url = `${APP_BASE}/?paid=demo`;
    const sent = phone.length >= 10 ? await sendSms(phone, `Pay your invoice: ${url}`) : false;
    return json({ url, sent, simulated: true });
  }
  const accountId = await accountFor(shopId);
  if (!accountId) return json({ error: "Connect the shop to Stripe first." }, 400);
  const session = await stripe("checkout/sessions", "POST", {
    mode: "payment",
    success_url: `${APP_BASE}/?paid=1`,
    cancel_url: `${APP_BASE}/?paid=0`,
    line_items: [
      { quantity: 1, price_data: { currency: "usd", unit_amount: amountCents, product_data: { name: "Auto service" } } },
    ],
    payment_intent_data: {
      application_fee_amount: feeCents,
      on_behalf_of: accountId,
      transfer_data: { destination: accountId },
      metadata: { shop_id: shopId, order_id: orderId },
    },
    metadata: { shop_id: shopId, order_id: orderId },
  });
  const sent = phone.length >= 10 ? await sendSms(phone, `Pay your invoice securely: ${session.url}`) : false;
  return json({ url: session.url, sent });
}

/* ---- webhook: mark the ticket paid ------------------------------------- */
async function handleWebhook(req: Request, sig: string) {
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
  const payload = await req.text();
  if (!secret || !(await verifySignature(payload, sig, secret))) return json({ error: "Bad signature" }, 400);
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(payload);
  } catch {
    return json({ error: "Bad payload" }, 400);
  }
  const type = String(event.type || "");
  const obj = (event.data as Record<string, unknown>)?.object as Record<string, unknown> | undefined;
  if (!obj) return json({ received: true });

  // A texted pay link that the customer completed.
  if (type === "checkout.session.completed" && obj.payment_status === "paid") {
    const md = (obj.metadata as Record<string, unknown>) || {};
    const shopId = String(md.shop_id || "");
    const orderId = String(md.order_id || "");
    if (shopId && orderId) {
      await recordPaymentOnOrder(shopId, orderId, {
        id: `stripe_${crypto.randomUUID().slice(0, 8)}`,
        method: "card",
        processor: "stripe",
        amount: (Number(obj.amount_total) || 0) / 100,
        cardType: "Card",
        ref: "",
        fee: 0, // the fee lives on the PaymentIntent; the desk shows gross here
        piId: String(obj.payment_intent || ""),
        via: "link",
        at: Date.now(),
      });
    }
  }
  return json({ received: true });
}

// Verify Stripe's `t=...,v1=...` signature header with the endpoint secret.
async function verifySignature(payload: string, header: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")) as [string, string][]);
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // constant-time-ish compare
  if (expected.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

const cap = (s: string) => s.replace(/^\w/, (c) => c.toUpperCase());
