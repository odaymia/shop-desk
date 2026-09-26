/* Cloud sync over Supabase.

   The local store (IndexedDB) stays the source the app reads from, so the
   desk works with no signal. Every local write is also queued in an
   outbox and pushed when there's a connection; a pull asks the server for
   anything changed since the last look and folds it into the local store.

   The Supabase project and the shop are shared with the time clock. Both
   apps write to the same `kv` table; this app only ever pulls its own
   `sd:` keys plus the few shared keys it needs (the staff list), so the
   clock's punches and settings never land on the counter PC, and the
   clock never pulls tickets onto the iPad.

   Key routing:
     sd:*                      -> `kv` table, last write wins
     gac:employees             -> `kv` table, shared with the time clock
     sd:sig:* / sd:photo:*     -> Storage bucket "media", under <shop>/desk-sig and desk-photo
     _cloud:*                  -> this device only, never synced

   Nothing in here touches React. The storage module wires it up. */
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../lib/cloudConfig.js";
import { SHARED_KEYS } from "../lib/keys.js";

const configured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const OUTBOX_KEY = "_cloud:outbox";
const SHOP_KEY = "_cloud:shop";
const SYNC_KEY = "_cloud:sync";
const EPOCH = "1970-01-01T00:00:00Z";
const PAGE = 1000;
const OWN_PREFIX = "sd:";

/* ---------- pure helpers ---------- */
export const keyKind = (key) => (/^sd:(sig|photo):/.test(key) ? "media" : "kv");
const isLocalOnly = (key) => key.startsWith("_");
const isOurs = (key) => key.startsWith(OWN_PREFIX) || SHARED_KEYS.includes(key);

/* sd:sig:<order>:<id>   -> <shop>/desk-sig/<order>_<id>.png
   sd:photo:<ts>:<id>    -> <shop>/desk-photo/<ts>_<id>.jpg */
export function mediaPath(shopId, key) {
  const [, kind, a, b] = key.split(":");
  return `${shopId}/desk-${kind}/${a}_${b}.${kind === "photo" ? "jpg" : "png"}`;
}

function dataUrlToBlob(dataUrl) {
  const [head, b64] = String(dataUrl).split(",");
  const mime = (head.match(/data:([^;]+)/) || [])[1] || "application/octet-stream";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
const blobToDataUrl = (blob) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
const isNetworkError = (e) =>
  (typeof navigator !== "undefined" && !navigator.onLine) ||
  /fetch|network|load failed|timed? ?out/i.test(String(e?.message || e));
const isAuthError = (e) => /jwt|expired|invalid token|not authenticated|401/i.test(String(e?.message || e)) || e?.status === 401;

/* The sign-in token normally renews itself. When it hasn't (the tab sat
   in the background, the computer slept), renew it once and retry; if
   that fails the shop has to sign in again, and the outbox waits. */
let renewing = null;
async function renewSession() {
  if (!renewing) {
    renewing = supabase.auth
      .refreshSession()
      .then(({ data, error }) => {
        if (error || !data.session) throw error || new Error("no session");
        setState({ user: userOf(data.session), needsSignIn: false });
        return true;
      })
      .catch(() => {
        setState({ needsSignIn: true, error: "Your sign-in expired. Sign in again under Cloud account — nothing is lost, waiting changes upload after." });
        return false;
      })
      .finally(() => {
        renewing = null;
      });
  }
  return renewing;
}

/* ---------- state ---------- */
let local = null; // raw backend: get/set/delete/list on JSON strings
let applyRemote = null; // (key, value) => writes local WITHOUT queueing
const listeners = new Set();
const state = {
  configured,
  user: null,
  shopId: null,
  shopName: "",
  linked: false,
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  pending: 0,
  lastSync: null,
  syncing: false,
  error: "",
  needsSignIn: false,
};
function emit(type, extra) {
  for (const fn of listeners) {
    try {
      fn({ type, ...extra });
    } catch (e) {
      console.error(e);
    }
  }
}
function setState(patch) {
  Object.assign(state, patch);
  emit("state");
}
async function lget(key, fallback) {
  try {
    const r = await local.get(key);
    return r && r.value != null ? JSON.parse(r.value) : fallback;
  } catch {
    return fallback;
  }
}
const lset = (key, v) => local.set(key, JSON.stringify(v));

/* ---------- outbox ---------- */
/* The queue lives in memory; persisting it to IndexedDB only guards
   against losing unsent writes on a reload. Writing the whole array on
   every enqueue makes a bulk import O(n^2) on the main thread — a 40k
   import would re-serialize a growing 40k-item array 40k times, which is
   what dragged the import to a crawl. So the persist is coalesced onto a
   short timer, and forced when the tab is hidden. */
let outbox = [];
let outboxTimer = null;
let outboxDirty = false;
function persistOutboxSoon() {
  outboxDirty = true;
  if (outboxTimer) return;
  outboxTimer = setTimeout(() => {
    outboxTimer = null;
    if (!outboxDirty) return;
    outboxDirty = false;
    lset(OUTBOX_KEY, outbox).catch(() => {});
  }, 500);
}
async function persistOutboxNow() {
  if (outboxTimer) {
    clearTimeout(outboxTimer);
    outboxTimer = null;
  }
  outboxDirty = false;
  try {
    await lset(OUTBOX_KEY, outbox);
  } catch {
    /* best effort */
  }
}
let pendingTimer = null;
function emitPendingSoon() {
  if (pendingTimer) return;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    setState({ pending: outbox.length });
  }, 250);
}
function enqueue(item, quiet) {
  outbox.push({ ...item, at: Date.now() });
  persistOutboxSoon();
  emitPendingSoon();
  if (!quiet) flush();
}
function pendingKvKeys() {
  return new Set(outbox.filter((it) => it.kind === "kv").map((it) => it.key));
}

async function push(item) {
  const shop_id = state.shopId;
  if (item.kind === "kv") {
    const q = supabase.from("kv");
    const { error } =
      item.op === "del"
        ? await q.delete().match({ shop_id, key: item.key })
        : await q.upsert({ shop_id, key: item.key, value: item.value });
    if (error) throw error;
  } else if (item.kind === "portal") {
    const { error } = await supabase.from("customer_portal").upsert({ shop_id, customer_id: item.customerId, email: item.email || null, phone: item.phone || null, data: item.data });
    if (error) throw error;
  } else if (item.kind === "shopPublic") {
    const { error } = await supabase.from("shop_public").upsert({ shop_id, data: item.data });
    if (error) throw error;

  } else if (item.kind === "media") {
    const bucket = supabase.storage.from("media");
    const path = mediaPath(shop_id, item.key);
    const { error } =
      item.op === "del"
        ? await bucket.remove([path])
        : await bucket.upload(path, dataUrlToBlob(item.value), { upsert: true });
    if (error) throw error;
  }
}

/* Consecutive kv writes go up in one request. An import can queue ten
   thousand of them; one at a time would take most of an hour. */
const BATCH = 200;
async function pushBatch(items) {
  const shop_id = state.shopId;
  const rows = new Map();
  for (const it of items) rows.set(it.key, { shop_id, key: it.key, value: it.value });
  const { error } = await supabase.from("kv").upsert([...rows.values()]);
  if (error) throw error;
}

let flushing = false;
let retryTimer = null;
async function flush() {
  if (!state.linked || flushing || !outbox.length) return;
  flushing = true;
  setState({ syncing: true });
  try {
    while (outbox.length) {
      const item = outbox[0];
      let n = 1;
      if (item.kind === "kv" && item.op === "put") {
        while (n < outbox.length && n < BATCH && outbox[n].kind === "kv" && outbox[n].op === "put") n++;
      }
      try {
        try {
          if (n > 1) await pushBatch(outbox.slice(0, n));
          else await push(item);
        } catch (e) {
          if (!isAuthError(e) || !(await renewSession())) throw e;
          if (n > 1) await pushBatch(outbox.slice(0, n));
          else await push(item);
        }
      } catch (e) {
        if (isAuthError(e)) return; // renewal failed; the state says to sign in again
        if (isNetworkError(e)) {
          setState({ error: "Offline — changes will upload when the connection is back" });
          clearTimeout(retryTimer);
          retryTimer = setTimeout(flush, 15000);
          return;
        }
        /* a change the server refuses would block everything behind it forever */
        console.error("cloud rejected a change, dropping it", item, e);
        setState({ error: `Cloud rejected a change: ${e.message || e}` });
      }
      outbox.splice(0, n);
      persistOutboxSoon();
      emitPendingSoon();
    }
    if (/Offline/.test(state.error)) setState({ error: "" });
  } finally {
    flushing = false;
    persistOutboxSoon();
    setState({ syncing: false, pending: outbox.length });
  }
}

/* ---------- pull ---------- */
let pulling = false;
let pullAgain = false;
let pullTimer = null;
function schedulePull(ms = 400) {
  clearTimeout(pullTimer);
  pullTimer = setTimeout(pull, ms);
}
/* only our keys and the shared ones; the clock's punches stay on the clock */
const keyFilter = [`key.like.${OWN_PREFIX}%`, ...SHARED_KEYS.map((k) => `key.eq.${k}`)].join(",");
async function pull() {
  if (!state.linked) return;
  if (pulling) {
    pullAgain = true;
    return;
  }
  pulling = true;
  try {
    const sync = await lget(SYNC_KEY, { kv: EPOCH });
    const skipKv = pendingKvKeys();
    let since = sync.kv;
    for (;;) {
      const { data, error } = await supabase
        .from("kv")
        .select("key,value,updated_at")
        .eq("shop_id", state.shopId)
        .or(keyFilter)
        .gt("updated_at", since)
        .order("updated_at")
        .limit(PAGE);
      if (error) throw error;
      /* Carry the values on the event so listeners don't have to read each
         key back out of IndexedDB — on a shop's first sync this page could
         hold a thousand records. */
      const keys = [];
      const values = {};
      for (const r of data) {
        since = r.updated_at;
        if (skipKv.has(r.key)) continue;
        await applyRemote(r.key, r.value);
        keys.push(r.key);
        values[r.key] = r.value ?? null;
      }
      /* Save progress after every page. A shop's first sync is tens of
         thousands of rows; persisting only at the end meant a reload
         partway through re-downloaded the whole shop from scratch, which
         is what dragged the counter PC to a crawl. Now an interrupted
         sync resumes where it left off. */
      sync.kv = since;
      await lset(SYNC_KEY, sync);
      if (keys.length) emit("data", { keys, values });
      if (data.length < PAGE) break;
      await new Promise((r) => setTimeout(r)); // yield so a big first sync never freezes the tab
    }
    setState({ lastSync: Date.now(), error: /Offline|Sync error/.test(state.error) ? "" : state.error });
  } catch (e) {
    if (isAuthError(e)) {
      if (await renewSession()) pullAgain = true;
    } else {
      if (!isNetworkError(e)) console.error("cloud pull failed", e);
      setState({ error: isNetworkError(e) ? "Offline — showing what's on this computer" : `Sync error: ${e.message || e}` });
    }
  } finally {
    pulling = false;
    if (pullAgain) {
      pullAgain = false;
      schedulePull(100);
    }
  }
}

/* ---------- live updates + loops ---------- */
let channel = null;
let pollTimer = null;
function start() {
  setState({ linked: true });
  if (!channel) {
    const filter = `shop_id=eq.${state.shopId}`;
    channel = supabase
      .channel(`desk-${state.shopId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "kv", filter }, (p) => {
        const key = (p.new && p.new.key) || (p.old && p.old.key) || "";
        if (!key || isOurs(key)) schedulePull();
      })
      .subscribe();
  }
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    flush();
    pull();
  }, 60000);
  flush();
  pull();
}
function stop() {
  setState({ linked: false });
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
  clearInterval(pollTimer);
}
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    setState({ online: true });
    flush();
    pull();
  });
  window.addEventListener("offline", () => setState({ online: false }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      flush();
      pull();
    } else {
      persistOutboxNow();
    }
  });
  window.addEventListener("pagehide", () => {
    persistOutboxNow();
  });
}

/* ---------- account + shop ---------- */
const userOf = (session) =>
  session?.user ? { id: session.user.id, email: session.user.email } : null;

async function init(backend, apply, opts = {}) {
  local = backend;
  applyRemote = apply;
  outbox = await lget(OUTBOX_KEY, []);
  setState({ pending: outbox.length });
  if (opts.demo || !configured) return; // demo mode stays local, never syncs
  const shop = await lget(SHOP_KEY, null);
  const {
    data: { session },
  } = await supabase.auth.getSession();
  setState({ user: userOf(session), shopId: shop?.id || null, shopName: shop?.name || "" });
  supabase.auth.onAuthStateChange((event, sess) => {
    setState({ user: userOf(sess) });
    if (event === "SIGNED_OUT") stop();
  });
  if (session && shop) start();
  else if (session) await linkShop();
}

/* Join the shop this account belongs to (the one the time clock made), or
   create one. The first computer to link seeds the cloud copy of the
   desk's data; a later one only uploads what the cloud doesn't have yet.
   Shared keys are never uploaded from here — the clock owns them. */
async function linkShop() {
  const { data: rows, error } = await supabase
    .from("shop_members")
    .select("shop_id, shops(name)")
    .order("created_at")
    .limit(1);
  if (error) throw error;
  let id;
  let name;
  const cloudHas = new Set();
  if (rows && rows.length) {
    id = rows[0].shop_id;
    name = rows[0].shops?.name || "";
    const { data: keys, error: e3 } = await supabase.from("kv").select("key").eq("shop_id", id).like("key", `${OWN_PREFIX}%`);
    if (e3) throw e3;
    for (const k of keys || []) cloudHas.add(k.key);
  } else {
    const cfg = await lget("sd:config", null);
    name = (cfg && cfg.shopName) || "My shop";
    const { data, error: e2 } = await supabase.rpc("create_shop", { shop_name: name });
    if (e2) throw e2;
    id = data;
  }
  await lset(SHOP_KEY, { id, name });
  await lset(SYNC_KEY, { kv: EPOCH });
  setState({ shopId: id, shopName: name });
  await uploadEverything(cloudHas);
  start();
}
async function uploadEverything(skipKv) {
  const r = await local.list(OWN_PREFIX);
  for (const key of (r && r.keys) || []) {
    const value = await lget(key, null);
    if (value == null) continue;
    const kind = keyKind(key);
    if (kind === "kv") {
      if (!skipKv.has(key)) await enqueue({ kind, op: "put", key, value }, true);
    } else await enqueue({ kind, op: "put", key, value }, true);
  }
}

async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  setState({ needsSignIn: false, error: "" });
  if (state.shopId) start(); // same shop, session renewed: pick up where we left off
  else await linkShop();
}
async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  if (data.session) {
    await linkShop();
    return "signedIn";
  }
  return "confirm";
}
async function signOut() {
  stop();
  await supabase.auth.signOut().catch(() => {});
  await local.delete(SHOP_KEY);
  setState({ user: null, shopId: null, shopName: "", needsSignIn: false, error: "" });
}

/* ---------- called by the storage module ---------- */
async function recordWrite(key, value) {
  if (!state.linked || isLocalOnly(key) || !isOurs(key)) return;
  /* Never push an uninitialized settings row to the cloud. An established
     shop always has a name; a nameless config is the fresh-install default,
     and pushing it would flatten the real settings for every device. This
     is the guard against a new browser / tablet / incognito sign-in wiping
     the shop's settings before its first sync finishes. */
  if (key === "sd:config" && !String((value && value.shopName) || "").trim()) return;
  return enqueue({ kind: keyKind(key), op: "put", key, value });
}
async function recordDelete(key) {
  if (!state.linked || isLocalOnly(key) || !isOurs(key)) return;
  return enqueue({ kind: keyKind(key), op: "del", key });
}
/* The customer portal reads its own tables; the desk pushes rows there
   through the same outbox so an offline post still gets published. */
async function publishPortal(customerId, email, phone, data) {
  if (!state.linked) return;
  return enqueue({ kind: "portal", customerId, email, phone, data });
}
async function publishShop(data) {
  if (!state.linked) return;
  return enqueue({ kind: "shopPublic", data });
}
/* The shop's public website (supabase/website.sql). Sent straight away,
   not queued, so the Publish button can say whether it worked (a taken web
   address, or the website tables not set up yet). */
async function publishSite(slug, published, data) {
  if (!state.linked) throw new Error("Sign this computer in to your shop (Settings → Data) to publish.");
  const { error } = await supabase.from("shop_site").upsert({ shop_id: state.shopId, slug, published, data });
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new Error(`The web address "${slug}" is taken. Pick another.`);
    if (/relation .* does not exist|schema cache/i.test(error.message)) throw new Error("The website tables aren't set up yet. Run supabase/website.sql in Supabase once.");
    throw error;
  }
}
/* What the booking form needs to post a request to this shop. */
function siteApi() {
  return state.linked && SUPABASE_URL && SUPABASE_ANON_KEY ? { url: SUPABASE_URL, key: SUPABASE_ANON_KEY, shopId: state.shopId } : null;
}
/* Is a web address free? The owner's own row counts as free. */
async function siteSlugTaken(slug) {
  if (!state.linked) return false;
  const { data, error } = await supabase.from("shop_site").select("shop_id").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return !!data && data.shop_id !== state.shopId;
}
/* Appointment requests sent from the website. Read live; handled by staff. */
async function listSiteRequests() {
  if (!state.linked) return [];
  const { data, error } = await supabase
    .from("site_requests")
    .select("id, name, phone, email, vehicle, service, preferred_day, note, created_at")
    .eq("shop_id", state.shopId)
    .is("handled_at", null)
    .order("created_at");
  if (error) throw error;
  return data || [];
}
async function handleSiteRequest(id) {
  if (!state.linked) return;
  const { error } = await supabase.from("site_requests").update({ handled_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

/* Email signups from the website, every one (the list is small next to
   the customer records, but page through anyway: the API caps a read). */
async function listSiteSignups() {
  if (!state.linked) return [];
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("site_signups")
      .select("id, email, name, source, created_at, unsubscribed_at")
      .eq("shop_id", state.shopId)
      .order("created_at")
      .range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}
/* Add people from an imported list, a batch at a time. `source` says where
   they came from ("SHOPIFY"). */
async function addSiteSignups(people, source) {
  if (!state.linked) throw new Error("Sign this computer in to your shop (Settings → Data) first.");
  let added = 0;
  for (let i = 0; i < people.length; i += 500) {
    const batch = people.slice(i, i + 500).map((p) => ({ shop_id: state.shopId, email: p.email, name: p.name || null, source }));
    const { error } = await supabase.from("site_signups").insert(batch);
    if (!error) {
      added += batch.length;
      continue;
    }
    if (/site_signups|schema cache|does not exist/i.test(error.message)) throw new Error("Run the latest supabase/website.sql in Supabase first.");
    /* one bad or already-there address fails the batch: go one by one */
    for (const row of batch) {
      const { error: e } = await supabase.from("site_signups").insert(row);
      if (!e) added++;
    }
  }
  return added;
}
async function setSignupUnsubscribed(ids, unsubscribed) {
  if (!state.linked || !ids.length) return;
  const { error } = await supabase.from("site_signups").update({ unsubscribed_at: unsubscribed ? new Date().toISOString() : null }).in("id", ids);
  if (error) throw error;
}

/* ---------- email (supabase/email.sql; sending is the "email" function) ---------- */
async function saveEmailMessage(m) {
  if (!state.linked) throw new Error("Sign this computer in to your shop (Settings → Data) first.");
  const { data, error } = await supabase
    .from("email_messages")
    .insert({ shop_id: state.shopId, kind: m.kind || "campaign", name: m.name || null, subject: m.subject, html: m.html, text_body: m.text || null, audience: m.audience || null })
    .select("id")
    .single();
  if (error) throw /email_messages|schema cache|does not exist/i.test(error.message) ? new Error("Email isn't set up yet: run supabase/email.sql in Supabase.") : error;
  return data.id;
}
/* sent and scheduled emails, newest first, with how many went out */
async function listEmailMessages(limit = 60) {
  if (!state.linked) return [];
  const { data, error } = await supabase.from("email_messages").select("id, kind, name, subject, audience, created_at").eq("shop_id", state.shopId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  const { data: counts } = await supabase.rpc("email_message_counts", { p_shop: state.shopId });
  const by = {};
  for (const c of counts || []) (by[c.message_id] = by[c.message_id] || {})[c.status] = Number(c.n);
  return (data || []).map((m) => ({ ...m, counts: by[m.id] || {} }));
}
async function listSuppressions() {
  if (!state.linked) return [];
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("email_suppressions").select("email, reason, created_at").eq("shop_id", state.shopId).range(from, from + 999);
    if (error) return out; // not set up yet: nothing suppressed server-side
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}
async function setSuppressed(email, on) {
  if (!state.linked) return;
  const e = String(email || "").trim().toLowerCase();
  const q = supabase.from("email_suppressions");
  const { error } = on ? await q.upsert({ shop_id: state.shopId, email: e, reason: "manual" }) : await q.delete().match({ shop_id: state.shopId, email: e });
  if (error && !/email_suppressions|schema cache|does not exist/i.test(error.message)) throw error;
}

/* ---------- postcards (supabase/mail.sql; mailing is the "mail" function) ---------- */
async function listMailKeys() {
  if (!state.linked) return [];
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("mail_keys").select("key").eq("shop_id", state.shopId).range(from, from + 999);
    if (error) throw /mail_keys|schema cache|does not exist/i.test(error.message) ? new Error("Postcards aren't set up yet: run supabase/mail.sql in Supabase.") : error;
    out.push(...(data || []).map((r) => r.key));
    if (!data || data.length < 1000) return out;
  }
}
async function listMailSends(limit = 100) {
  if (!state.linked) return [];
  const { data, error } = await supabase.from("mail_sends").select("id, batch_id, name, address, status, expected_delivery, error, created_at").eq("shop_id", state.shopId).order("created_at", { ascending: false }).limit(limit);
  if (error) return [];
  return data || [];
}

/* Customer requests from the portal. Read live; handled by staff. */
async function listPortalRequests() {
  if (!state.linked) return [];
  const { data, error } = await supabase
    .from("portal_requests")
    .select("id, customer_id, email, vehicle_id, kind, note, created_at")
    .eq("shop_id", state.shopId)
    .is("handled_at", null)
    .order("created_at");
  if (error) throw error;
  return data || [];
}
async function handlePortalRequest(id) {
  if (!state.linked) return;
  const { error } = await supabase.from("portal_requests").update({ handled_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}
async function fetchMedia(key) {
  if (!state.linked) return null;
  const { data, error } = await supabase.storage.from("media").download(mediaPath(state.shopId, key));
  if (error || !data) return null;
  return blobToDataUrl(data);
}

/* The shop's public card as last published (name, phone, address, hours,
   tax rate, invoice footer, logo…). It lives in its own table, so it
   survives even if the settings row is overwritten — a recovery source. */
async function readShopPublic() {
  if (!supabase || !state.shopId) return null;
  const { data, error } = await supabase.from("shop_public").select("data").eq("shop_id", state.shopId).maybeSingle();
  if (error) throw error;
  return data ? data.data : null;
}

export const cloud = {
  configured,
  init,
  getState: () => ({ ...state }),
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  signIn,
  signUp,
  signOut,
  linkShop,
  syncNow() {
    flush();
    pull();
  },
  recordWrite,
  recordDelete,
  fetchMedia,
  readShopPublic,
  publishPortal,
  publishShop,
  listPortalRequests,
  handlePortalRequest,
  publishSite,
  siteApi,
  siteSlugTaken,
  listSiteRequests,
  handleSiteRequest,
  listSiteSignups,
  setSignupUnsubscribed,
  addSiteSignups,
  saveEmailMessage,
  listEmailMessages,
  listSuppressions,
  setSuppressed,
  listMailKeys,
  listMailSends,
  /* Call a Supabase Edge Function as the signed-in shop user. Used for
     distributor lookups (tire search/order) that must run server-side so
     the wholesale credentials never reach the browser. */
  async invoke(name, body) {
    if (!supabase) throw new Error("offline");
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (error) throw error;
    return data;
  },
};
