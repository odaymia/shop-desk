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
let outbox = [];
let chain = Promise.resolve();
const withOutbox = (fn) => (chain = chain.then(fn, fn));
async function enqueue(item, quiet) {
  await withOutbox(async () => {
    outbox.push({ ...item, at: Date.now() });
    await lset(OUTBOX_KEY, outbox);
    setState({ pending: outbox.length });
  });
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
        if (n > 1) await pushBatch(outbox.slice(0, n));
        else await push(item);
      } catch (e) {
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
      await withOutbox(async () => {
        outbox.splice(0, n);
        await lset(OUTBOX_KEY, outbox);
        setState({ pending: outbox.length });
      });
    }
    if (/Offline/.test(state.error)) setState({ error: "" });
  } finally {
    flushing = false;
    setState({ syncing: false });
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
  const changed = new Set();
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
      for (const r of data) {
        since = r.updated_at;
        if (skipKv.has(r.key)) continue;
        await applyRemote(r.key, r.value);
        changed.add(r.key);
      }
      if (data.length < PAGE) break;
    }
    sync.kv = since;
    await lset(SYNC_KEY, sync);
    setState({ lastSync: Date.now(), error: /Offline|Sync error/.test(state.error) ? "" : state.error });
  } catch (e) {
    if (!isNetworkError(e)) console.error("cloud pull failed", e);
    setState({ error: isNetworkError(e) ? "Offline — showing what's on this computer" : `Sync error: ${e.message || e}` });
  } finally {
    pulling = false;
    if (changed.size) emit("data", { keys: [...changed] });
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
    }
  });
}

/* ---------- account + shop ---------- */
const userOf = (session) =>
  session?.user ? { id: session.user.id, email: session.user.email } : null;

async function init(backend, apply) {
  local = backend;
  applyRemote = apply;
  outbox = await lget(OUTBOX_KEY, []);
  setState({ pending: outbox.length });
  if (!configured) return;
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
  await linkShop();
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
  await supabase.auth.signOut();
  await local.delete(SHOP_KEY);
  setState({ user: null, shopId: null, shopName: "" });
}

/* ---------- called by the storage module ---------- */
async function recordWrite(key, value) {
  if (!state.linked || isLocalOnly(key) || !isOurs(key)) return;
  return enqueue({ kind: keyKind(key), op: "put", key, value });
}
async function recordDelete(key) {
  if (!state.linked || isLocalOnly(key) || !isOurs(key)) return;
  return enqueue({ kind: keyKind(key), op: "del", key });
}
async function fetchMedia(key) {
  if (!state.linked) return null;
  const { data, error } = await supabase.storage.from("media").download(mediaPath(state.shopId, key));
  if (error || !data) return null;
  return blobToDataUrl(data);
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
};
