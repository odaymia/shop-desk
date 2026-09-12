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
  const text = `${(item && item.description) || ""} ${cat}`.toLowerCase();
  if (/cabin/.test(text)) return "Cabin Air Filters";
  if (/oil ?filter/.test(text)) return "Oil Filters";
  if (/air ?filter|air element|engine air/.test(text)) return "Engine Air Filters";
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
      };
    })
    .sort((a, b) => b.suggestedOrder - a.suggestedOrder || b.sold - a.sold);
}
