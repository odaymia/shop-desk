/* Register the offline service worker (see public/sw.js). Uses Vite's BASE_URL
   so it resolves correctly whether the app is served from a domain root or a
   subfolder. Registration failure is non-fatal — the desk still runs online. */
export function registerSW() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((e) => console.warn("service worker registration failed", e));
  });
}
