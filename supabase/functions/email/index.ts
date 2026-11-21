// Supabase Edge Function: the shop's email sender (campaigns and automatic
// emails), through Resend. Tables: supabase/email.sql.
//
// Actions (POST JSON { action, ... }):
//   queue        (shop member) put a message in the outbox for a list of
//                people; skips anyone unsubscribed and any automation email
//                already sent (dedupe), then starts sending
//   drain        (shop member, or the scheduler with x-cron-secret) send
//                what's due, a batch at a time, within the daily limit
//   test         (shop member) send one copy of a message to one address now
//   status       (shop member) is sending set up, sent today, daily limit
//   unsubscribe  (public, with the signed token from the email) stop all
//                marketing email to that address
// Mail apps' one-click unsubscribe (RFC 8058) POSTs to ?u=<token> directly.
//
// Resend's webhooks POST here too (told apart by their svix-id header): each
// says an email was delivered, opened, clicked, bounced or marked as spam,
// and is recorded on that email's outbox row (email_event in email.sql).
//
// Deploy: Supabase dashboard → Edge Functions → Deploy a new function → name
// it "email" → paste this file → turn OFF "Enforce JWT verification" (the
// unsubscribe link has to work for people who aren't signed in; staff
// actions check the sign-in themselves). Secrets (Edge Functions → Secrets):
//   RESEND_API_KEY      from resend.com → API Keys
//   EMAIL_SECRET        any long random string; signs unsubscribe links
//   EMAIL_UNSUB_PAGE    the unsubscribe page, e.g.
//                       https://odaymia.github.io/shop-desk/unsubscribe/
//   EMAIL_DEFAULT_FROM  (optional) sender for shops without their own verified
//                       domain, e.g. "Bolt Badger <mail@yourdomain.com>"
//   EMAIL_CRON_SECRET   (optional) lets a scheduled job call { action: "drain" }
//   RESEND_WEBHOOK_SECRET  for opens and clicks: the "Signing secret"
//                       (whsec_…) of the webhook made in resend.com → Webhooks,
//                       pointed at this function's URL with the events
//                       email.delivered, email.opened, email.clicked,
//                       email.bounced and email.complained. Also turn on Open
//                       tracking and Click tracking for the domain in Resend.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(SUPA_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const RESEND = Deno.env.get("RESEND_API_KEY") || "";
const SECRET = Deno.env.get("EMAIL_SECRET") || "";
const UNSUB_PAGE = Deno.env.get("EMAIL_UNSUB_PAGE") || "";
const DEFAULT_FROM = Deno.env.get("EMAIL_DEFAULT_FROM") || "";
const CRON_SECRET = Deno.env.get("EMAIL_CRON_SECRET") || "";
const WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET") || "";
const FN_URL = `${SUPA_URL}/functions/v1/email`;

const str = (s: unknown) => String(s ?? "").trim();
const norm = (e: unknown) => str(e).toLowerCase();
const validEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ---------- signed unsubscribe tokens: base64url(shop|email).sig ---------- */
const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
async function sign(data: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)))).slice(0, 32);
}
async function unsubToken(shopId: string, email: string) {
  const data = `${shopId}|${norm(email)}`;
  return `${b64u(new TextEncoder().encode(data))}.${await sign(data)}`;
}
async function readToken(t: string): Promise<{ shopId: string; email: string } | null> {
  const [d, s] = str(t).split(".");
  if (!d || !s || !SECRET) return null;
  let data = "";
  try {
    data = fromB64u(d);
  } catch {
    return null;
  }
  if ((await sign(data)) !== s) return null;
  const [shopId, email] = data.split("|");
  return shopId && email ? { shopId, email } : null;
}

/* ---------- who's calling ---------- */
async function memberShop(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const asUser = createClient(SUPA_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: u } = await asUser.auth.getUser();
  if (!u || !u.user) return null;
  const { data: m } = await asUser.from("shop_members").select("shop_id").limit(1);
  return m && m.length ? (m[0].shop_id as string) : null;
}

/* the shop's sending settings, from its desk settings (kv sd:config) */
async function shopEmailCfg(shopId: string) {
  const { data } = await admin.from("kv").select("value").eq("shop_id", shopId).eq("key", "sd:config").maybeSingle();
  const cfg = (data && (data.value as Record<string, unknown>)) || {};
  const e = (cfg.email as Record<string, unknown>) || {};
  const name = str(e.fromName) || str(cfg.shopName) || "Our shop";
  const fromEmail = str(e.fromEmail);
  return {
    enabled: e.enabled !== false,
    from: fromEmail && validEmail(fromEmail) ? `${name.replace(/[<>"]/g, "")} <${fromEmail}>` : DEFAULT_FROM ? DEFAULT_FROM.replace(/^[^<]*</, `${name.replace(/[<>"]/g, "")} via Bolt Badger <`) : "",
    replyTo: validEmail(str(e.replyTo)) ? str(e.replyTo) : validEmail(str(cfg.shopEmail)) ? str(cfg.shopEmail) : "",
    dailyLimit: Math.max(1, Number(e.dailyLimit) || 100),
  };
}

async function suppressedSet(shopId: string, emails: string[]) {
  const set = new Set<string>();
  for (let i = 0; i < emails.length; i += 500) {
    const chunk = emails.slice(i, i + 500);
    const { data: s } = await admin.from("email_suppressions").select("email").eq("shop_id", shopId).in("email", chunk);
    for (const r of s || []) set.add(norm(r.email));
    const { data: u } = await admin.from("site_signups").select("email").eq("shop_id", shopId).not("unsubscribed_at", "is", null).in("email", chunk);
    for (const r of u || []) set.add(norm(r.email));
  }
  return set;
}

const fill = (s: string, vars: Record<string, string>, html: boolean) =>
  s.replace(/\{(first_name|vehicle|due_date|unsubscribe_url)\}/g, (_, k) => {
    let v = str(vars[k]);
    if (k === "first_name" && !v) v = "there";
    return html ? esc(v) : v;
  });

/* one email as Resend wants it */
async function build(shopId: string, cfg: Awaited<ReturnType<typeof shopEmailCfg>>, msg: Record<string, string>, to: string, vars: Record<string, string>) {
  const token = await unsubToken(shopId, to);
  const page = UNSUB_PAGE ? `${UNSUB_PAGE}${UNSUB_PAGE.includes("?") ? "&" : "?"}u=${token}` : `${FN_URL}?u=${token}`;
  const v = { ...vars, unsubscribe_url: page };
  return {
    from: cfg.from,
    to: [to],
    subject: fill(msg.subject, v, false),
    html: fill(msg.html, v, true),
    text: msg.text_body ? fill(msg.text_body, v, false) : undefined,
    reply_to: cfg.replyTo || undefined,
    headers: { "List-Unsubscribe": `<${FN_URL}?u=${token}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}

async function resend(path: string, body: unknown) {
  const res = await fetch(`https://api.resend.com${path}`, { method: "POST", headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { ok: res.ok, status: res.status, data, error: res.ok ? "" : str((data as { message?: string }).message) || text.slice(0, 300) };
}

/* ---------- sending ---------- */
async function sentToday(shopId: string) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { count } = await admin.from("email_outbox").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("status", "sent").gte("sent_at", start.toISOString());
  return count || 0;
}

async function drainShop(shopId: string, maxBatches = 8) {
  const cfg = await shopEmailCfg(shopId);
  if (!RESEND) return { sent: 0, note: "Sending isn't set up yet (no RESEND_API_KEY)." };
  if (!cfg.from) return { sent: 0, note: "No sender address. Set one in Email → Settings." };
  if (!cfg.enabled) return { sent: 0, note: "Email is turned off in Email → Settings." };
  /* anything stuck mid-send for 15 minutes goes back in line */
  await admin.from("email_outbox").update({ status: "queued" }).eq("shop_id", shopId).eq("status", "sending").lt("claimed_at", new Date(Date.now() - 15 * 60000).toISOString());
  let sent = 0;
  const messages = new Map<string, Record<string, string>>();
  for (let b = 0; b < maxBatches; b++) {
    const room = cfg.dailyLimit - (await sentToday(shopId));
    if (room <= 0) return { sent, note: `Daily limit of ${cfg.dailyLimit} reached; the rest go out tomorrow.` };
    const { data: rows, error } = await admin.rpc("email_claim", { p_shop: shopId, p_limit: Math.min(100, room) });
    if (error) throw error;
    if (!rows || !rows.length) break;
    const blocked = await suppressedSet(shopId, rows.map((r: { email: string }) => norm(r.email)));
    const go = rows.filter((r: { email: string }) => !blocked.has(norm(r.email)));
    const skip = rows.filter((r: { email: string }) => blocked.has(norm(r.email)));
    if (skip.length) await admin.from("email_outbox").update({ status: "skipped", error: "unsubscribed" }).in("id", skip.map((r: { id: number }) => r.id));
    if (!go.length) continue;
    for (const r of go) {
      if (!messages.has(r.message_id)) {
        const { data: m } = await admin.from("email_messages").select("subject, html, text_body").eq("id", r.message_id).maybeSingle();
        messages.set(r.message_id, (m as Record<string, string>) || { subject: "", html: "", text_body: "" });
      }
    }
    const batch = [];
    for (const r of go) batch.push(await build(shopId, cfg, messages.get(r.message_id)!, str(r.email), (r.vars as Record<string, string>) || {}));
    const out = await resend("/emails/batch", batch);
    if (out.status === 429) {
      await admin.from("email_outbox").update({ status: "queued" }).in("id", go.map((r: { id: number }) => r.id));
      await sleep(1500);
      continue;
    }
    const now = new Date().toISOString();
    if (!out.ok) {
      await admin.from("email_outbox").update({ status: "failed", error: out.error.slice(0, 500) }).in("id", go.map((r: { id: number }) => r.id));
      return { sent, note: `Resend refused the batch: ${out.error}` };
    }
    const ids = ((out.data as { data?: { id: string }[] }).data || []).map((x) => x.id);
    await Promise.all(go.map((r: { id: number }, i: number) => admin.from("email_outbox").update({ status: "sent", sent_at: now, provider_id: ids[i] || null, error: null }).eq("id", r.id)));
    sent += go.length;
    await sleep(600); // stay under Resend's 2 requests a second
  }
  return { sent };
}

async function unsubscribe(t: string) {
  const who = await readToken(t);
  if (!who) return null;
  await admin.from("email_suppressions").upsert({ shop_id: who.shopId, email: who.email, reason: "unsubscribed" });
  await admin.from("site_signups").update({ unsubscribed_at: new Date().toISOString() }).eq("shop_id", who.shopId).ilike("email", who.email.replace(/[%_\\]/g, "\\$&")).is("unsubscribed_at", null);
  const { data } = await admin.from("kv").select("value").eq("shop_id", who.shopId).eq("key", "sd:config").maybeSingle();
  return { email: who.email, shop: str(data && (data.value as Record<string, unknown>).shopName) };
}

/* ---------- Resend webhooks: delivered, opened, clicked, bounced, complained ----------
   Signed the Svix way: HMAC-SHA256 over "<id>.<timestamp>.<body>" with the
   base64 part of the whsec_ secret; the header may carry several signatures.
   tests/emailStats.test.js runs the two functions between the markers. */
/* <webhook-core> */
async function validWebhook(secret: string, id: string, timestamp: string, sigHeader: string, body: string, nowMs = Date.now()) {
  if (!secret || !id || !timestamp || !sigHeader) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > 5 * 60) return false; // stale or replayed
  let keyBytes: Uint8Array;
  try {
    keyBytes = Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)));
  const want = btoa(String.fromCharCode(...mac));
  for (const part of sigHeader.split(" ")) {
    const got = part.startsWith("v1,") ? part.slice(3) : "";
    if (got.length !== want.length) continue;
    let diff = 0;
    for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
    if (diff === 0) return true;
  }
  return false;
}

/* The one fact each notice carries, or null for kinds we don't record. */
function readEvent(ev: Record<string, unknown>, unsubPrefixes: string[]) {
  const kind = ({ "email.delivered": "delivered", "email.opened": "opened", "email.clicked": "clicked", "email.bounced": "bounced", "email.complained": "complained" } as Record<string, string>)[str(ev.type)];
  const d = (ev.data as Record<string, unknown>) || {};
  const providerId = str(d.email_id);
  if (!kind || !providerId) return null;
  const click = (d.click as Record<string, unknown>) || {};
  const bounce = (d.bounce as Record<string, unknown>) || {};
  const url = kind === "clicked" ? str(click.link) : "";
  /* the unsubscribe link is a link too, but tapping it isn't interest */
  if (kind === "clicked" && unsubPrefixes.some((p) => p && url.startsWith(p))) return null;
  const at = str(click.timestamp) || str(ev.created_at) || str(d.created_at);
  const when = at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : new Date().toISOString();
  return { kind, providerId, url, at: when, detail: kind === "bounced" ? str(bounce.type) || "Permanent" : "" };
}
/* </webhook-core> */

async function webhook(req: Request) {
  const raw = await req.text();
  const id = req.headers.get("svix-id") || "";
  if (!WEBHOOK_SECRET) return json({ error: "Webhook secret not set" }, 503);
  if (!(await validWebhook(WEBHOOK_SECRET, id, req.headers.get("svix-timestamp") || "", req.headers.get("svix-signature") || "", raw))) return json({ error: "Bad signature" }, 401);
  let ev: Record<string, unknown> = {};
  try {
    ev = JSON.parse(raw);
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const e = readEvent(ev, [UNSUB_PAGE, FN_URL]);
  if (!e) return json({ ok: true, ignored: true });
  const record = () => admin.rpc("email_event", { p_event_id: id, p_provider_id: e.providerId, p_type: e.kind, p_at: e.at, p_url: e.url || null, p_detail: e.detail || null });
  let { data, error } = await record();
  /* a notice can beat the send to the database by a moment: the id of an
     email just sent may not be saved on its row yet. Look once more. */
  if (!error && data === "unknown") {
    await sleep(2500);
    ({ data, error } = await record());
  }
  if (error) return json({ error: "Couldn't record" }, 500); // Resend tries again later
  return json({ ok: true, result: data });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (req.headers.get("svix-id")) return webhook(req);

  /* one-click unsubscribe from the mail app: POST ?u=<token> */
  const u = new URL(req.url).searchParams.get("u");
  if (u) {
    const r = await unsubscribe(u);
    return r ? json({ ok: true, ...r }) : json({ error: "This link isn't valid." }, 400);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const action = str(body.action);

  if (action === "unsubscribe") {
    const r = await unsubscribe(str(body.token));
    return r ? json({ ok: true, ...r }) : json({ error: "This link isn't valid. Reply to the email and we'll take you off the list." }, 400);
  }

  /* the scheduler: send what's due for every shop */
  if (action === "drain" && CRON_SECRET && req.headers.get("x-cron-secret") === CRON_SECRET) {
    const { data } = await admin.from("email_outbox").select("shop_id").eq("status", "queued").lte("send_after", new Date().toISOString()).limit(1000);
    const shops = [...new Set((data || []).map((r) => r.shop_id as string))];
    const results: Record<string, unknown> = {};
    for (const s of shops) results[s] = await drainShop(s, 4);
    return json({ ok: true, results });
  }

  const shopId = await memberShop(req);
  if (!shopId) return json({ error: "Sign in first" }, 401);

  if (action === "status") {
    const cfg = await shopEmailCfg(shopId);
    const { count: queued } = await admin.from("email_outbox").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("status", "queued");
    /* opens and clicks: is the webhook secret in place, and has anything arrived */
    const { data: lastEv, error: evErr } = await admin.from("email_outbox").select("delivered_at").eq("shop_id", shopId).not("delivered_at", "is", null).order("delivered_at", { ascending: false }).limit(1);
    const tracking = { secret: !!WEBHOOK_SECRET, tables: !evErr, lastEventAt: (lastEv && lastEv[0] && (lastEv[0].delivered_at as string)) || null };
    return json({ ready: !!RESEND && !!SECRET && !!cfg.from, hasKey: !!RESEND, from: cfg.from, replyTo: cfg.replyTo, dailyLimit: cfg.dailyLimit, sentToday: await sentToday(shopId), queued: queued || 0, tracking, webhookUrl: FN_URL });
  }

  if (action === "drain") return json({ ok: true, ...(await drainShop(shopId)) });

  if (action === "test") {
    const to = str(body.to);
    if (!validEmail(to)) return json({ error: "Enter an email address to send the test to." }, 400);
    const { data: m } = await admin.from("email_messages").select("shop_id, subject, html, text_body").eq("id", str(body.messageId)).maybeSingle();
    if (!m || m.shop_id !== shopId) return json({ error: "Save the email first." }, 404);
    const cfg = await shopEmailCfg(shopId);
    if (!RESEND) return json({ error: "Sending isn't set up yet: add RESEND_API_KEY to the email function's secrets." }, 400);
    if (!cfg.from) return json({ error: "Set a sender address in Email → Settings first." }, 400);
    const one = await build(shopId, cfg, m as Record<string, string>, to, { first_name: str(body.firstName), vehicle: "2018 Honda Civic", due_date: "October 12" });
    one.subject = `[Test] ${one.subject}`;
    const out = await resend("/emails", one);
    return out.ok ? json({ ok: true }) : json({ error: `Resend: ${out.error}` }, 400);
  }

  if (action === "queue") {
    const messageId = str(body.messageId);
    const { data: m } = await admin.from("email_messages").select("shop_id").eq("id", messageId).maybeSingle();
    if (!m || m.shop_id !== shopId) return json({ error: "Save the email first." }, 404);
    const sendAfter = body.sendAfter ? new Date(str(body.sendAfter)).toISOString() : new Date().toISOString();
    const people = ((body.recipients as { email: string; vars?: Record<string, string>; dedupe?: string }[]) || [])
      .map((r) => ({ email: str(r.email), vars: r.vars || {}, dedupe: r.dedupe ? str(r.dedupe).slice(0, 200) : null }))
      .filter((r) => validEmail(r.email));
    /* no one twice in the same send, no one unsubscribed, no automation email already sent */
    const seen = new Set<string>();
    const uniq = people.filter((r) => {
      const k = r.dedupe || norm(r.email);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const blocked = await suppressedSet(shopId, uniq.map((r) => norm(r.email)));
    let list = uniq.filter((r) => !blocked.has(norm(r.email)));
    const keys = list.map((r) => r.dedupe).filter(Boolean) as string[];
    if (keys.length) {
      const done = new Set<string>();
      for (let i = 0; i < keys.length; i += 500) {
        const { data } = await admin.from("email_outbox").select("dedupe").eq("shop_id", shopId).in("dedupe", keys.slice(i, i + 500));
        for (const r of data || []) done.add(r.dedupe as string);
      }
      list = list.filter((r) => !r.dedupe || !done.has(r.dedupe));
    }
    let queued = 0;
    for (let i = 0; i < list.length; i += 500) {
      const rows = list.slice(i, i + 500).map((r) => ({ shop_id: shopId, message_id: messageId, email: r.email, vars: r.vars, dedupe: r.dedupe, send_after: sendAfter }));
      const { error } = await admin.from("email_outbox").insert(rows);
      if (!error) {
        queued += rows.length;
        continue;
      }
      for (const row of rows) {
        const { error: e } = await admin.from("email_outbox").insert(row); // a dedupe collision loses only that one
        if (!e) queued++;
      }
    }
    const drained = sendAfter <= new Date().toISOString() && queued ? await drainShop(shopId, 2) : { sent: 0 };
    return json({ ok: true, queued, unsubscribed: blocked.size, alreadySent: uniq.length - blocked.size - list.length, ...drained });
  }

  return json({ error: "Unknown action" }, 400);
});
