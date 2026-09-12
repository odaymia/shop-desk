/* Inventory reporting: what sold, and how much to reorder. Pure — no
   React, DOM, or storage. The front desk and the tests call these. */
import { round2, lineAmount, lineCost } from "./invoice.js";

const DAY = 86400000;

/* The category to group an item under. Filters are split into oil,
   engine air, and cabin air by what the part reads like, so reports show
   them apart even when they were all imported as one "Filters" category.
   Anything else keeps its own category. */
export function itemCategory(item) {
  const cat = String((item && item.category) || "").trim();
  const num = String((item && item.number) || "").trim().toUpperCase();
  const text = `${(item && item.description) || ""} ${cat}`.toLowerCase();
  if (/cabin/.test(text)) return "Cabin Air Filters";
  if (/oil ?filter/.test(text)) return "Oil Filters";
  if (/air ?filter|air element|engine air/.test(text)) return "Engine Air Filters";
  /* brake pads number like SC…, rotors end in RGS (the shop's numbering) */
  if (num.length >= 4 && num.startsWith("SC")) return "Brake Pads";
  if (num.endsWith("RGS")) return "Brake Rotors";
  return cat || "Uncategorized";
}

/* Units and money per item sold (invoiced) in a window. Parts linked to
   inventory group by their part id; hand-typed parts group by number and
   description so the same thing typed twice still adds up. */
export function salesByItem(orders, parts, fromTs, toTs) {
  const map = new Map();
  for (const o of Object.values(orders || {})) {
    if (o.status !== "invoiced") continue;
    if (!(o.invoicedAt >= fromTs && o.invoicedAt <= toTs)) continue;
    for (const l of o.lines || []) {
      if (l.kind !== "part") continue;
      const qty = Number(l.qty) || 0;
      if (!qty) continue;
      const p = l.partId ? (parts || {})[l.partId] : null;
      const key = l.partId ? `id:${l.partId}` : `t:${String(l.number || "").toLowerCase()}|${String(l.description || "").toLowerCase()}`;
      let row = map.get(key);
      if (!row) {
        row = {
          key,
          partId: l.partId || null,
          number: (p && p.number) || l.number || "",
          description: (p && p.description) || l.description || "",
          category: (p && p.category) || "",
          onHand: p ? Number(p.onHand) || 0 : null,
          qty: 0,
          revenue: 0,
          cost: 0,
        };
        map.set(key, row);
      }
      row.qty = round2(row.qty + qty);
      row.revenue = round2(row.revenue + lineAmount(l));
      row.cost = round2(row.cost + lineCost(l));
    }
  }
  return [...map.values()]
    .map((r) => ({ ...r, category: itemCategory(r), profit: round2(r.revenue - r.cost) }))
    .sort((a, b) => b.revenue - a.revenue);
}

/* Quarts in one purchase unit, from how the part is bought. Everything is
   still counted and sold by the quart; this is only for reordering.
   - case: the entered size is quarts (a 6-quart case)
   - box:  the entered size is gallons (a 5-gallon box = 20 qt)
   - bulk: the entered size is the minimum-order gallons (110 gal = 440 qt) */
export function packQuartsOf(part) {
  const size = Number((part && part.packSize) || 0);
  if (!size) return 0;
  if (part.packType === "case") return size;
  if (part.packType === "box" || part.packType === "bulk") return size * 4;
  return 0;
}

/* Turn a quart shortfall into a purchase order: whole cases/boxes rounded
   up, or a bulk order at or above the minimum. Returns the count, the
   quarts that actually buys, and a label for the receipt of the order. */
export function purchaseOrder(quartsNeeded, packType, packQuarts) {
  const need = Math.max(0, Math.ceil(Number(quartsNeeded) || 0));
  const pk = Number(packQuarts) || 0;
  if (need <= 0) return { quarts: 0, packs: 0, text: "—" };
  if ((packType === "case" || packType === "box") && pk > 0) {
    const packs = Math.ceil(need / pk);
    const quarts = packs * pk;
    const unit = packType === "case" ? "case" : "box";
    return { quarts, packs, text: `${packs} ${unit}${packs === 1 ? "" : "s"} (${quarts} qt)` };
  }
  if (packType === "bulk" && pk > 0) {
    const quarts = Math.max(need, pk);
    const gal = Math.round((quarts / 4) * 10) / 10;
    return { quarts, packs: null, text: `${gal} gal bulk${quarts === pk ? " (min)" : ""}` };
  }
  return { quarts: need, packs: null, text: String(need) };
}

/* How much of each stocked item to order so on-hand plus the order lasts
   `coverDays`, based on how fast it sold over the window. Only items that
   actually moved and are linked to inventory (you can order those). */
export function reorderPlan(orders, parts, fromTs, toTs, coverDays) {
  const days = Math.max(1, (toTs - fromTs) / DAY);
  const cover = Math.max(1, Number(coverDays) || 14);
  return salesByItem(orders, parts, fromTs, toTs)
    .filter((s) => s.partId && (parts || {})[s.partId])
    .map((s) => {
      const part = parts[s.partId];
      const onHand = Number(part.onHand) || 0;
      const perDay = s.qty / days;
      const need = perDay * cover;
      const suggestedOrder = Math.max(0, Math.ceil(round2(need - onHand)));
      const daysLeft = perDay > 0 ? Math.floor(onHand / perDay) : null;
      const po = purchaseOrder(suggestedOrder, part.packType, packQuartsOf(part));
      return {
        partId: s.partId,
        number: s.number,
        description: s.description,
        category: s.category,
        onHand,
        sold: s.qty,
        days: round2(days),
        perDay: round2(perDay),
        perWeek: round2(perDay * 7),
        cover,
        need: round2(need),
        suggestedOrder,
        daysLeft,
        packType: part.packType || "",
        orderQuarts: po.quarts,
        orderPacks: po.packs,
        orderText: po.text,
      };
    })
    .sort((a, b) => b.suggestedOrder - a.suggestedOrder || b.sold - a.sold);
}
