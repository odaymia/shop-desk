/* Parts catalog helpers. Pure — no React, no storage.

   A punchout catalog (PartsTech, and through it O'Reilly First Call,
   AutoZone, NAPA, WorldPac) hands back a cart: what was picked, from
   which supplier, at what cost. This turns that cart into ticket lines
   priced with the shop's markup. */

export const CATALOGS = [
  ["oreilly", "O'Reilly First Call", "https://www.firstcallonline.com"],
  ["partstech", "PartsTech", "https://app.partstech.com"],
  ["nexpart", "Nexpart", "https://www.nexpart.com"],
  ["autozone", "AutoZone Pro", "https://www.autozonepro.com"],
  ["napa", "NAPA PROLink", "https://www.napaprolink.com"],
];

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* Sell price from cost: markup percent, then finish on .99 when asked.
   A part with a list price higher than the marked-up cost sells at list,
   which is how most shops do it. */
export function sellPrice(cost, list, cfg) {
  const c = Number(cost) || 0;
  const pct = Number(cfg?.partsMarkupPct);
  let p = round2(c * (1 + (Number.isFinite(pct) ? pct : 35) / 100));
  const l = Number(list) || 0;
  if (l > p) p = l;
  if (cfg?.partsPriceEnding99 && p > 1) p = Math.ceil(p) - 0.01;
  return round2(p);
}

/* Cart items → part lines. Items: { partNumber, description, brand,
   quantity, cost, list, supplier, tire, size }. */
export function cartToLines(cart, cfg, mkId) {
  const out = [];
  for (const it of (cart && cart.items) || []) {
    const qty = Number(it.quantity) || 1;
    const desc = [it.brand, it.description].filter(Boolean).join(" ").trim() || it.partNumber || "Part";
    out.push({
      id: mkId(),
      kind: "part",
      number: String(it.partNumber || "").toUpperCase(),
      partId: null,
      description: it.tire && it.size && !desc.includes(it.size) ? `${desc} ${it.size}` : desc,
      qty,
      price: sellPrice(it.cost, it.list, cfg),
      cost: round2(it.cost),
      condition: "new",
      taxable: null,
      job: cart.job || "",
      vendor: it.supplier || cart.supplier || "",
      catalog: { source: cart.source || "partstech", orderId: cart.externalOrderId || null, lineId: it.id || null },
    });
  }
  return out;
}
