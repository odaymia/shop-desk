// Supabase Edge Function: TireConnect webhooks -> desk inbox.
//
// TireConnect POSTs order/quote events here; this verifies the signature,
// pulls out the customer, vehicle, tires and total, and stores one row in
// tire_orders for the shop. The desk lists new ones and turns them into
// tickets. No customer-facing output — it just returns 200/4xx to TireConnect.
//
// Deploy: Supabase dashboard -> Edge Functions -> Deploy a new function ->
// name it "tireconnect" -> paste this file. No extra secrets: each shop's
// signing secret lives in the tire_connect table (set from the desk under
// Settings -> Website -> TireConnect). Run supabase/tireconnect.sql first.
//
// The shop is named in the URL: .../functions/v1/tireconnect?shop=<shopId>.
// In TireConnect Admin -> Settings -> Webhooks, add that URL, copy the Secret
// it shows, and paste the Secret into the desk so signatures line up.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPA_URL, SERVICE_KEY);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tireconnect-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown) => String(v ?? "").trim();

// base64 HMAC-SHA256 of the raw body, keyed with the shop's secret
async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}
// constant-time string compare
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

// TireConnect wraps the data differently per event; find the quote-like object
function findQuote(body: any): any {
  const d = body?.data ?? body;
  if (d?.quote) return d.quote; // order click
  if (Array.isArray(d?.leads) && d.leads[0]?.quotes?.[0]) return d.leads[0].quotes[0]; // lead
  if (Array.isArray(d?.quotes) && d.quotes[0]) return d.quotes[0];
  if (Array.isArray(d?.tires)) return d; // bare order
  return d || {};
}
function vehicleText(v: any): string {
  if (!v) return "";
  return [v.year, v.make, v.model, v.submodel].map(str).filter(Boolean).join(" ");
}
function customerOf(body: any, quote: any) {
  const c = quote?.customer || body?.data?.customer || body?.customer || quote?.location || body?.data?.location || body?.location || {};
  return { name: str(c.contact_name || c.name), phone: str(c.phone), email: str(c.email) };
}
function summaryOf(quote: any): string {
  const tires = Array.isArray(quote?.tires) ? quote.tires : [];
  if (!tires.length) return "";
  const t = tires[0];
  const name = [str(t.brand_name), str(t.model_name)].filter(Boolean).join(" ") || "Tires";
  const head = `${num(t.quantity) || 1}× ${name} ${str(t.size)}`.trim();
  return tires.length > 1 ? `${head} +${tires.length - 1} more` : head;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);

  const shopId = new URL(req.url).searchParams.get("shop") || "";
  if (!shopId) return reply({ error: "missing shop" }, 400);

  const raw = await req.text();

  // load the shop's signing secret and verify
  const { data: cfg } = await admin.from("tire_connect").select("webhook_secret").eq("shop_id", shopId).maybeSingle();
  const secret = str(cfg?.webhook_secret);
  if (!secret) return reply({ error: "shop not configured" }, 403);
  const sig = req.headers.get("x-tireconnect-signature") || "";
  const expected = await sign(secret, raw);
  if (!sig || !safeEqual(sig, expected)) return reply({ error: "bad signature" }, 401);

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply({ error: "bad json" }, 400);
  }

  const event = str(body?.event || body?.type || body?.name) || "order";
  const quote = findQuote(body);
  const tcUuid = str(quote?.quote_uuid || quote?.order_uuid || body?.data?.order_uuid || body?.order_uuid || body?.uuid || body?.id) || null;
  const cust = customerOf(body, quote);
  const vehicle = vehicleText(quote?.vehicle || body?.data?.vehicle || body?.vehicle);

  const row = {
    shop_id: shopId,
    event,
    tc_uuid: tcUuid,
    customer_name: cust.name || null,
    customer_phone: cust.phone || null,
    customer_email: cust.email || null,
    vehicle: vehicle || null,
    summary: summaryOf(quote) || null,
    total: num(quote?.total_price) || null,
    quote,
    raw: body,
  };

  // a repeat of the same order/quote (same tc_uuid) updates its row; rows
  // with no tc_uuid are all distinct, so they insert each time
  const { error } = await admin.from("tire_orders").upsert(row, { onConflict: "shop_id,event,tc_uuid" });
  if (error) {
    console.error("tire_orders write failed", error);
    return reply({ error: "store failed" }, 500);
  }
  return reply({ ok: true });
});
