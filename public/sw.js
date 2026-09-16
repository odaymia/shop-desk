/* Bolt Badger front desk — offline service worker.

   The desk already runs entirely from the device's own IndexedDB, so tickets,
   invoices, and payments never needed the network. This service worker closes
   the last gap: it caches the app's own code so the desk cold-starts with no
   internet — a wall-mounted kiosk can be unplugged, rebooted, and reopened
   offline and still open.

   Strategy:
   - Navigations / HTML → network-first (so a fresh deploy is picked up the
     moment there's a connection), falling back to the cached shell offline.
   - Static assets (content-hashed JS/CSS/fonts/images, and the on-demand oil-
     spec chunk) → cache-first; they're immutable, so once fetched they serve
     from cache forever, including offline. Revalidated quietly in the
     background when online.
   - Cross-origin requests (the Supabase sync layer, anything else) are left
     completely alone — the SW never touches them.

   Bump VERSION to force old caches to clear on the next deploy. */

const VERSION = "v1";
const SHELL = "bb-shell-" + VERSION;
const ASSETS = "bb-assets-" + VERSION;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; // never cache writes
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave Supabase & other origins to the network

  const accept = req.headers.get("accept") || "";
  const isPage = req.mode === "navigate" || accept.includes("text/html");

  if (isPage) {
    // network-first: fresh shell when online, cached shell when offline
    e.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const cache = await caches.open(SHELL);
          cache.put(req, res.clone());
          return res;
        } catch {
          const cache = await caches.open(SHELL);
          return (await cache.match(req)) || (await cache.match("index.html")) || (await cache.match("./")) || Response.error();
        }
      })()
    );
    return;
  }

  // static assets: cache-first, revalidate in the background
  e.respondWith(
    (async () => {
      const cache = await caches.open(ASSETS);
      const cached = await cache.match(req);
      if (cached) {
        fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
          })
          .catch(() => {});
        return cached;
      }
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        return cached || Response.error();
      }
    })()
  );
});
