// Supabase Edge Function: remote signing by text.
//
// The front desk texts a customer a link; the customer opens it, reviews the
// estimate/invoice, and signs. Three actions, one function:
//   - create  (signed-in shop member): stores a snapshot, texts the link via
//             Twilio, returns { token, link }.
//   - get     (public, by token): returns the snapshot to display.
//   - submit  (public, by token): saves the signature and writes it back onto
//             the order so it appears on the desk's ticket.
//
// Deploy: Supabase dashboard → Edge Functions → Deploy a new function → name it
// "sign" → paste this file. Then add these secrets under Edge Functions →
// Secrets (from your Twilio console):
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM   (TWILIO_FROM is your
//   Twilio phone number, e.g. +16195551234)
//   SIGN_BASE_URL   (where the app is hosted, e.g. https://desk.yourshop.com/ —
//   the customer's link becomes <SIGN_BASE_URL>sign/?t=<token>)
// Until Twilio is set the function still creates the request and returns the
// link (so you can copy/text it yourself), it just can't auto-send.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPA_URL, SERVICE_KEY);

const token = () => crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
const digits = (s: string) => String(s || "").replace(/\D/g, "");

async function sendSms(to: string, message: string): Promise<{ sent: boolean; error?: string }> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const auth = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_FROM");
  if (!sid || !auth || !from) return { sent: false, error: "Texting not set up yet" };
  const d = digits(to);
  const e164 = d.length === 10 ? `+1${d}` : d.startsWith("1") && d.length === 11 ? `+${d}` : `+${d}`;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${sid}:${auth}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: e164, From: from, Body: message }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error("twilio send failed", res.status, t);
    return { sent: false, error: "Text could not be sent" };
  }
  return { sent: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const action = String(body.action || "");

  // ---- public: fetch the snapshot to display ----
  if (action === "get") {
    const t = String(body.token || "");
    const { data } = await admin.from("sign_requests").select("payload,status,expires_at").eq("token", t).maybeSingle();
    if (!data) return json({ error: "This link is no longer valid." }, 404);
    if (new Date(data.expires_at) < new Date()) return json({ error: "This link has expired. Please ask the shop to resend it." }, 410);
    return json({ payload: data.payload, status: data.status });
  }

  // ---- public: submit the signature ----
  if (action === "submit") {
    const t = String(body.token || "");
    const sig = body.signature as { img?: string; name?: string } | undefined;
    if (!sig || !sig.img) return json({ error: "Please sign in the box first." }, 400);
    const { data: sr } = await admin.from("sign_requests").select("shop_id,order_id,slot,status,expires_at").eq("token", t).maybeSingle();
    if (!sr) return json({ error: "This link is no longer valid." }, 404);
    if (sr.status === "signed") return json({ ok: true, already: true });
    if (new Date(sr.expires_at) < new Date()) return json({ error: "This link has expired." }, 410);
    const at = Date.now();
    const signature = { img: sig.img, name: String(sig.name || "").slice(0, 120), at };
    await admin.from("sign_requests").update({ status: "signed", signature }).eq("token", t);
    // write the signature back onto the order so it shows on the desk's ticket
    const key = `sd:order:${sr.order_id}`;
    const { data: row } = await admin.from("kv").select("value").eq("shop_id", sr.shop_id).eq("key", key).maybeSingle();
    if (row && row.value) {
      const order = row.value as Record<string, unknown>;
      const sigs = (order.signatures as Record<string, unknown>) || {};
      sigs[sr.slot] = signature;
      order.signatures = sigs;
      order.history = [...((order.history as unknown[]) || []), { at, what: `signed remotely: ${sr.slot === "delivery" ? "vehicle received" : "estimate approved"}` }];
      await admin.from("kv").upsert({ shop_id: sr.shop_id, key, value: order });
    }
    return json({ ok: true });
  }

  // ---- signed-in shop member: create a request and text it ----
  if (action === "create") {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Sign in first" }, 401);
    const asUser = createClient(SUPA_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await asUser.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Sign in first" }, 401);
    const { data: member } = await asUser.from("shop_members").select("shop_id").limit(1);
    if (!member || !member.length) return json({ error: "No shop linked" }, 403);
    const shopId = member[0].shop_id as string;

    const orderId = String(body.orderId || "");
    const slot = body.slot === "delivery" ? "delivery" : "authorization";
    const phone = digits(String(body.phone || ""));
    const payload = body.payload;
    if (!orderId || !payload) return json({ error: "Missing order" }, 400);
    if (phone.length < 10) return json({ error: "The customer needs a valid cell number on file." }, 400);

    const t = token();
    await admin.from("sign_requests").insert({ token: t, shop_id: shopId, order_id: orderId, slot, payload });
    const base = (Deno.env.get("SIGN_BASE_URL") || "").replace(/\/$/, "");
    const link = base ? `${base}/sign/?t=${t}` : `sign/?t=${t}`;

    const p = payload as Record<string, unknown>;
    const kind = p.kind === "invoice" ? "invoice" : "estimate";
    const msg = `${p.shopName || "Your shop"}: please review and sign your ${kind} #${p.number || ""}. ${link}`;
    const { sent, error } = await sendSms(phone, msg);
    return json({ token: t, link, sent, sendError: error || null });
  }

  return json({ error: "Unknown action" }, 400);
});
