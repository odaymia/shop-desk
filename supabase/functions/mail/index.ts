// Supabase Edge Function: oil change reminder postcards, printed and mailed
// by Lob (lob.com). Tables: supabase/mail.sql.
//
// Actions (POST JSON { action, ... }, shop members only):
//   status   are the Lob keys set, cards mailed this month
//   proof    make one card with Lob's TEST key: nothing is printed or mailed,
//            and Lob returns a PDF of exactly what would print
//   send     mail a batch the owner approved: { front, back, cards: [{ to,
//            vars, dedupe: [keys], customerId }], batchId }. Each reminder is
//            reserved first (mail_keys), so none is ever mailed twice.
//
// Deploy: Supabase dashboard → Edge Functions → Deploy a new function → name
// it "mail" → paste this file (JWT verification can stay ON). Secrets:
//   LOB_TEST_KEY   Lob → Settings → API Keys → Test key (test_…)
//   LOB_LIVE_KEY   the Live key (live_…); needed only to really mail
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(SUPA_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const TEST = Deno.env.get("LOB_TEST_KEY") || "";
const LIVE = Deno.env.get("LOB_LIVE_KEY") || "";
const str = (s: unknown) => String(s ?? "").trim();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fill = (html: string, vars: Record<string, string>) =>
  html.replace(/\{(first_name|vehicle|due_date)\}/g, (_, k) => esc(str(vars[k]) || (k === "first_name" ? "there" : "")));

async function memberShop(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const asUser = createClient(SUPA_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: u } = await asUser.auth.getUser();
  if (!u || !u.user) return null;
  const { data: m } = await asUser.from("shop_members").select("shop_id").limit(1);
  return m && m.length ? (m[0].shop_id as string) : null;
}

/* the return address: the shop, from its settings */
async function fromAddress(shopId: string) {
  const { data } = await admin.from("kv").select("value").eq("shop_id", shopId).eq("key", "sd:config").maybeSingle();
  const cfg = (data && (data.value as Record<string, unknown>)) || {};
  const w = (cfg.website as Record<string, unknown>) || {};
  const street = str(cfg.shopAddress).split(",")[0];
  const m = str(w.cityLine).match(/^(.+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (!street || !m) return null;
  return { name: str(cfg.shopName).slice(0, 40), address_line1: street, address_city: m[1], address_state: m[2].toUpperCase(), address_zip: m[3], address_country: "US" };
}

async function lob(key: string, body: unknown, idem?: string) {
  const headers: Record<string, string> = { Authorization: `Basic ${btoa(`${key}:`)}`, "Content-Type": "application/json" };
  if (idem) headers["Idempotency-Key"] = idem;
  const res = await fetch("https://api.lob.com/v1/postcards", { method: "POST", headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  const err = res.ok ? "" : str((data as { error?: { message?: string } }).error?.message) || `Lob ${res.status}`;
  return { ok: res.ok, data: data as Record<string, unknown>, error: err };
}
const hash = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 48);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const shopId = await memberShop(req);
  if (!shopId) return json({ error: "Sign in first" }, 401);
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const action = str(body.action);

  if (action === "status") {
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const { count } = await admin.from("mail_sends").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("status", "mailed").gte("created_at", start.toISOString());
    return json({ hasTest: !!TEST, hasLive: !!LIVE, from: await fromAddress(shopId), mailedThisMonth: count || 0 });
  }

  const front = str(body.front);
  const back = str(body.back);
  if (!front || !back) return json({ error: "Missing the card design" }, 400);
  if (front.length > 10000 || back.length > 10000) return json({ error: "The card design is too long for Lob (10,000 characters a side)" }, 400);
  const from = await fromAddress(shopId);
  if (!from) return json({ error: "Add the shop's street address (Settings → Company info) and city, state, ZIP (Settings → Website) first." }, 400);

  if (action === "proof") {
    if (!TEST) return json({ error: "Add LOB_TEST_KEY to the mail function's secrets." }, 400);
    const card = (body.card as { to: Record<string, string>; vars: Record<string, string> }) || { to: from, vars: {} };
    const out = await lob(TEST, { description: "Proof", to: card.to || from, from, front: fill(front, card.vars || {}), back: fill(back, card.vars || {}), size: "4x6", use_type: "marketing" });
    return out.ok ? json({ ok: true, url: out.data.url, id: out.data.id }) : json({ error: `Lob: ${out.error}` }, 400);
  }

  if (action === "send") {
    if (!LIVE) return json({ error: "Add LOB_LIVE_KEY to the mail function's secrets to mail for real." }, 400);
    const cards = ((body.cards as { to: Record<string, string>; vars: Record<string, string>; dedupe: string[]; customerId: string }[]) || []).slice(0, 100);
    const batchId = str(body.batchId).slice(0, 60) || new Date().toISOString().slice(0, 10);
    let mailed = 0;
    const failed: string[] = [];
    let already = 0;
    for (const c of cards) {
      const keys = (c.dedupe || []).map((k) => str(k).slice(0, 200)).filter(Boolean);
      if (!keys.length || !c.to) continue;
      /* reserve the reminder(s); if any is taken, this card already went out */
      const { error: rErr } = await admin.from("mail_keys").insert(keys.map((key) => ({ shop_id: shopId, key })));
      if (rErr) {
        already++;
        continue;
      }
      const out = await lob(LIVE, { description: `Oil reminder ${batchId}`, to: c.to, from, front: fill(front, c.vars || {}), back: fill(back, c.vars || {}), size: "4x6", use_type: "marketing", metadata: { batch: batchId } }, await hash(`${shopId}|${keys.join(",")}`));
      if (out.ok) {
        mailed++;
        await admin.from("mail_sends").insert({ shop_id: shopId, batch_id: batchId, customer_id: str(c.customerId), name: str(c.to.name), address: c.to, keys, status: "mailed", lob_id: str(out.data.id), expected_delivery: out.data.expected_delivery_date || null });
      } else {
        /* give the reminder back so the card can be tried again (after fixing the address) */
        await admin.from("mail_keys").delete().eq("shop_id", shopId).in("key", keys);
        failed.push(`${str(c.to.name)}: ${out.error}`);
        await admin.from("mail_sends").insert({ shop_id: shopId, batch_id: batchId, customer_id: str(c.customerId), name: str(c.to.name), address: c.to, keys, status: "failed", error: out.error.slice(0, 500) });
      }
    }
    return json({ ok: true, mailed, already, failed });
  }

  return json({ error: "Unknown action" }, 400);
});
