/* TireConnect widget integration — pure helpers (no React, no DOM).

   The embedded TireConnect "Tire & Wheel" widget fires client-side
   callbacks (onTireSelect, onEcommerceOrderClick, onEcommerceOrder,
   onLead) that hand us the tires, services, vehicle and prices the
   customer chose. These helpers turn that payload into the shop's own
   line/tire shapes so it can be built into a ticket. See
   src/desk/TireConnectEmbed.jsx for the DOM side.

   Payload shapes are TireConnect's (documented), normalized defensively
   so a missing or renamed field never throws. */

import { normalizeTireSize } from "./tires.js";

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/* The shop pastes its whole TireConnect embed into Website settings. The
   in-app picker only needs the API key and the widget-script URL out of
   it. */
export function tcApiKey(embed) {
  const m = String(embed || "").match(/apikey\s*:\s*['"]?([A-Za-z0-9_-]{8,})['"]?/);
  return m ? m[1] : "";
}
export function tcScriptSrc(embed) {
  const m = String(embed || "").match(/<script[^>]+src=["']([^"']+(?:tireconnect|widget)[^"']*)["']/i);
  return m ? m[1] : "https://app.tireconnect.ca/js/widget.js";
}

/* "215/45R17 91V XL" or specs.size {part_1,part_2,part_3} -> "215/45R17". */
export function tcTireSize(tire) {
  const s = tire && tire.specs && tire.specs.size;
  if (s && s.part_1 && s.part_2 && s.part_3) return normalizeTireSize(`${s.part_1}/${s.part_2}R${s.part_3}`);
  return normalizeTireSize(String((tire && tire.size) || "").split(/\s+/)[0] || "");
}

export function tcTireName(tire) {
  return [tire && tire.brand_name, tire && tire.model_name].map((x) => String(x || "").trim()).filter(Boolean).join(" ") || "Tire";
}

export function tcLoadSpeed(tire) {
  const sp = tire && tire.specs;
  if (!sp) return "";
  return [sp.load_index, sp.speed_rating].filter((x) => x != null && x !== "").join("");
}

/* One tire from an onTireSelect / onTireSearchResults entry, shaped like
   the non-inventory tire the tire-quote builder's pickTire expects:
   { description, size, number, price, cost }. fet is carried along so a
   caller can add a federal-excise-tax fee line when it isn't zero. */
export function tcTire(tire) {
  return {
    description: tcTireName(tire),
    size: tcTireSize(tire),
    number: String((tire && tire.part_number) || "").trim(),
    loadSpeed: tcLoadSpeed(tire),
    price: num(tire && tire.price),
    cost: num(tire && tire.cost),
    fet: num(tire && tire.fet),
    quantity: Math.max(1, Math.round(num(tire && tire.quantity)) || 1),
  };
}

export function tcVehicle(v) {
  if (!v) return null;
  const year = v.year ? String(v.year) : "";
  const parts = [year, v.make, v.model, v.submodel].map((x) => String(x || "").trim()).filter(Boolean);
  if (!parts.length) return null;
  return { year, make: String(v.make || "").trim(), model: String(v.model || "").trim(), submodel: String(v.submodel || "").trim(), label: parts.join(" ") };
}

export function tcCustomer(src) {
  const c = (src && (src.customer || src.location)) || null;
  if (!c) return null;
  const name = String(c.contact_name || c.name || "").trim();
  const email = String(c.email || "").trim();
  const phone = String(c.phone || "").trim();
  if (!name && !email && !phone) return null;
  return { name, email, phone };
}

/* The first tire of an onTireSelect payload, plus the vehicle. */
export function tireFromSelect(payload) {
  const tire = payload && Array.isArray(payload.tires) ? payload.tires[0] : null;
  if (!tire) return null;
  return { tire: tcTire(tire), vehicle: tcVehicle(payload && payload.vehicle) };
}

/* A TireConnect quote/cart (onEcommerceOrderClick.quote, onEcommerceOrder,
   or an onLead quote) turned into ready-to-add ticket lines. Used by the
   full-cart import and by the webhook inbox. `id` is an id-maker.

   - each tire -> a part line (brand model size, qty, price, cost)
   - a non-zero FET -> one fee line (not taxable)
   - each selected service -> a labor line (type "service") or fee line
     (type "fee"); tax_group "not_taxable" forces taxable:false
   - each discount -> a negative discount line
   Totals (subtotal/tax/total) are returned for reference, not as lines —
   the ticket recomputes its own tax under the shop's rules. */
export function quoteToLines(quote, { id } = {}) {
  const mkId = typeof id === "function" ? id : (() => `tc${Math.random().toString(36).slice(2, 10)}`);
  const lines = [];
  const tires = (quote && quote.tires) || [];
  for (const t of tires) {
    const n = tcTire(t);
    lines.push({ id: mkId(), kind: "part", condition: "new", partId: null, number: n.number, description: [n.description, n.size].filter(Boolean).join(" "), qty: n.quantity, price: n.price, cost: n.cost, taxable: true, job: "Tires" });
    if (n.fet > 0) lines.push({ id: mkId(), kind: "fee", description: "Federal excise tax (FET)", qty: n.quantity, price: n.fet, taxable: false, job: "Tires" });
  }
  for (const s of (quote && quote.services) || []) {
    const price = num(s && s.price);
    if (!(price > 0)) continue; // null/0-priced services aren't charged
    const notTaxable = s && s.tax_group === "not_taxable";
    if (s && s.type === "fee") {
      lines.push({ id: mkId(), kind: "fee", description: String(s.name || "Fee"), qty: 1, price, taxable: false, job: "Tires" });
    } else {
      lines.push({ id: mkId(), kind: "labor", description: String((s && s.name) || "Service"), hours: 1, rate: price, taxable: notTaxable ? false : null, job: "Tires" });
    }
  }
  for (const d of (quote && quote.discounts) || []) {
    const amt = num(d && d.total_amount);
    if (amt > 0) lines.push({ id: mkId(), kind: "discount", description: String((d && d.name) || "Discount"), qty: 1, price: -amt, taxable: true, job: "Tires" });
  }
  return {
    lines,
    vehicle: tcVehicle(quote && quote.vehicle),
    customer: tcCustomer(quote),
    totals: { subtotal: num(quote && quote.subtotal), tax: num(quote && quote.total_tax), total: num(quote && quote.total_price) },
  };
}

/* Pull the quote object out of whichever event delivered it. */
export function quoteFromEvent(payload) {
  if (!payload) return null;
  if (payload.quote) return payload.quote; // onEcommerceOrderClick
  if (Array.isArray(payload.tires)) return payload; // onEcommerceOrder
  if (Array.isArray(payload.leads) && payload.leads[0] && Array.isArray(payload.leads[0].quotes)) return payload.leads[0].quotes[0]; // onLead
  return null;
}
