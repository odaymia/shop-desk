import { useEffect, useRef, useState } from "react";
import { tireFromSelect, quoteFromEvent, quoteToLines } from "../lib/tireconnect.js";

/* Embeds the shop's TireConnect "Tire & Wheel" widget inside the desk so
   an advisor can search the live supplier catalog and drop a tire (or a
   whole cart) onto the ticket. TireConnect's TCWidget is a page-level
   singleton, so this mounts one instance, tears it down on unmount, and
   reads its client-side callbacks:
     - onTireSelect       -> onPickTire(tire, vehicle)   (one tire)
     - onEcommerceOrderClick / onLead -> onImportQuote({lines, vehicle, customer})
   The event payload is read from event.data (older builds) or the event
   itself, and event.resolve() is always called so the widget flow
   continues. */

let scriptPromise = null;
function loadWidgetScript(src) {
  if (typeof window !== "undefined" && window.TCWidget) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("Could not load the TireConnect widget."));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

const payloadOf = (event) => (event && typeof event === "object" && "data" in event ? event.data : event);
const resolve = (event) => {
  try {
    if (event && typeof event.resolve === "function") event.resolve();
  } catch {
    /* ignore */
  }
};

export function TireConnectEmbed({ apikey, scriptSrc, onPickTire, onImportQuote, idMaker, flash }) {
  const holder = useRef(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  // keep the latest callbacks without re-initing the widget
  const cbs = useRef({});
  cbs.current = { onPickTire, onImportQuote, idMaker, flash };

  useEffect(() => {
    let widget = null;
    let dead = false;
    const node = holder.current;
    // a unique container id so re-opens don't collide with a stale node
    const containerId = `tc-embed-${Math.random().toString(36).slice(2, 9)}`;
    if (node) node.id = containerId;

    loadWidgetScript(scriptSrc)
      .then(() => {
        if (dead || !window.TCWidget) return;
        const ready = window.TCWidget.init({ apikey, container: containerId });
        const wire = (w) => {
          widget = w || window.TCWidget;
          const on = (widget && widget.on) || window.TCWidget.on;
          if (!on) return;
          const bind = on.bind(widget && widget.on ? widget : window.TCWidget);
          bind("onTireSelect", (event) => {
            const r = tireFromSelect(payloadOf(event));
            if (r && cbs.current.onPickTire) cbs.current.onPickTire(r.tire, r.vehicle);
            resolve(event);
          });
          const importer = (event) => {
            const q = quoteFromEvent(payloadOf(event));
            if (q && cbs.current.onImportQuote) cbs.current.onImportQuote(quoteToLines(q, { id: cbs.current.idMaker }));
            resolve(event);
          };
          bind("onEcommerceOrderClick", importer);
          bind("onLead", importer);
          setStatus("ready");
        };
        if (ready && typeof ready.then === "function") ready.then(wire).catch(() => setStatus("error"));
        else wire(ready);
      })
      .catch(() => {
        if (!dead) setStatus("error");
      });

    return () => {
      dead = true;
      try {
        if (widget && typeof widget.destroy === "function") widget.destroy();
        else if (window.TCWidget && typeof window.TCWidget.destroy === "function") window.TCWidget.destroy();
      } catch {
        /* ignore */
      }
      if (node) node.innerHTML = "";
    };
  }, [apikey, scriptSrc]);

  return (
    <div className="tcEmbed">
      {status === "error" && (
        <p className="fldErr" style={{ margin: "8px 0" }}>
          Couldn't load the TireConnect catalog. Check the widget embed in Settings → Website, or your internet connection.
        </p>
      )}
      {status === "loading" && <p className="muted" style={{ margin: "8px 0" }}>Loading the live tire catalog…</p>}
      <div ref={holder} className="tcEmbedWidget" />
    </div>
  );
}
