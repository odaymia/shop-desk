/* IndexedDB backend for the storage module. Same shape as the
   window.storage API a Claude artifact provides, so the rest of the app
   can't tell which one it's talking to. IndexedDB rather than
   localStorage because a year of punch photos blows past the
   localStorage quota. */

const DB = "shopDesk";
const STORE = "kv";

export function createIndexedDbStorage() {
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }

  function tx(mode, fn) {
    return open().then(
      (db) =>
        new Promise((res, rej) => {
          const t = db.transaction(STORE, mode);
          const out = fn(t.objectStore(STORE));
          /* a request for a missing key has result === undefined; resolve
             to that, never to the request object itself */
          t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out);
          t.onerror = () => rej(t.error);
          t.onabort = () => rej(t.error);
        })
    );
  }

  /* Ask Safari not to evict this data. Without it, iOS can clear site
     storage after a stretch of disuse. Adding to the Home Screen plus
     this call is what keeps punches around. */
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  return {
    get: (key) =>
      tx("readonly", (s) => s.get(key)).then((v) =>
        v === undefined ? null : { key, value: v, shared: false }
      ),
    set: (key, value) =>
      tx("readwrite", (s) => {
        s.put(value, key);
      }).then(() => ({ key, value, shared: false })),
    delete: (key) =>
      tx("readwrite", (s) => {
        s.delete(key);
      }).then(() => ({ key, deleted: true, shared: false })),
    list: (prefix) =>
      tx("readonly", (s) => s.getAllKeys()).then((keys) => {
        const all = keys || [];
        const filtered = prefix ? all.filter((k) => String(k).indexOf(prefix) === 0) : all;
        return { keys: filtered, prefix, shared: false };
      }),
  };
}
