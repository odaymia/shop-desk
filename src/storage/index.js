/* The one storage module. Everything in the app reads and writes through
   here. The backend is a small async key-value API — get(key), set(key,
   value), delete(key), list(prefix) — over IndexedDB.

   Reads always come from the local store, so the desk works with no
   signal. Writes land locally first and are then mirrored to the cloud
   by src/storage/cloud.js when the computer is signed in to a shop. */
import { createIndexedDbStorage } from "./indexeddb.js";
import { cloud, keyKind } from "./cloud.js";
import { DEMO } from "../lib/demo.js";

export { cloud };
export const storage = window.storage || createIndexedDbStorage();

/* the cloud layer writes pulled data through here, bypassing the outbox */
const applyRemote = async (key, value) => {
  if (value == null) await storage.delete(key);
  else await storage.set(key, JSON.stringify(value));
};

let readyPromise = null;
export function storageReady() {
  if (!readyPromise) {
    readyPromise = cloud.init(storage, applyRemote, { demo: DEMO }).catch((e) => console.error("cloud init failed", e));
  }
  return readyPromise;
}

async function readLocal(key, fallback) {
  try {
    const r = await storage.get(key);
    return r && r.value != null ? JSON.parse(r.value) : fallback;
  } catch {
    return fallback;
  }
}

export async function sGet(key, fallback) {
  try {
    const r = await storage.get(key);
    if (r && r.value != null) return JSON.parse(r.value);
    /* media (signatures, photos) isn't synced ahead of time; fetch on demand */
    if (keyKind(key) === "media") {
      const data = await cloud.fetchMedia(key);
      if (data != null) {
        await storage.set(key, JSON.stringify(data));
        return data;
      }
    }
    return fallback;
  } catch {
    return fallback;
  }
}
export async function sSet(key, value) {
  try {
    await storage.set(key, JSON.stringify(value));
    cloud.recordWrite(key, value).catch((e) => console.error("cloud queue failed", key, e));
    return true;
  } catch (e) {
    console.error("storage write failed", key, e);
    return false;
  }
}
export async function sDel(key) {
  try {
    await storage.delete(key);
  } catch {
    /* already gone */
  }
  cloud.recordDelete(key).catch((e) => console.error("cloud queue failed", key, e));
}
export async function sList(prefix) {
  try {
    const r = await storage.list(prefix);
    return (r && r.keys) || [];
  } catch {
    return [];
  }
}

/* Read every record under a prefix in one go. Returns [[key, value]].
   The desk keeps one key per customer, vehicle, part, and order. IndexedDB
   reads are local and quick; a few thousand records take well under a
   second. */
const GETALL_PAGE = 4000;
/* Read everything under a prefix, a page at a time, yielding between pages.
   A full shop's history is tens of thousands of records; reading it in one
   shot froze the tab for many seconds at startup. Paging keeps each read
   short and lets the browser paint and handle input in between, so the
   machine stays responsive while the data loads. Set `onChunk` to consume
   pages as they arrive instead of buffering the whole thing. */
export async function sGetAll(prefix, onChunk) {
  if (storage.getAllPage) {
    try {
      const out = onChunk ? null : [];
      let after = null;
      for (;;) {
        const r = await storage.getAllPage(prefix, after, GETALL_PAGE);
        const keys = (r && r.keys) || [];
        const values = (r && r.values) || [];
        const chunk = [];
        for (let i = 0; i < values.length; i++) {
          let v = null;
          try {
            v = values[i] != null ? JSON.parse(values[i]) : null;
          } catch {
            v = null;
          }
          if (v != null) chunk.push([keys[i], v]);
        }
        if (onChunk) onChunk(chunk);
        else for (const pair of chunk) out.push(pair);
        if (keys.length < GETALL_PAGE) break;
        after = keys[keys.length - 1];
        await new Promise((res) => setTimeout(res)); // yield between pages
      }
      return out;
    } catch {
      /* fall back to the per-key path below */
    }
  }
  const keys = await sList(prefix);
  const out = onChunk ? null : [];
  const push = onChunk ? (k, v) => onChunk([[k, v]]) : (k, v) => out.push([k, v]);
  for (const k of keys) {
    const v = await readLocal(k, null);
    if (v != null) push(k, v);
  }
  return out;
}
