/* What the shop-floor bay display shows a tech about the car on the ticket:
   the services being done, and for an oil change the big three — the oil
   type, how many quarts, and which filter. Pure — no React, DOM, or storage. */
import { hasOilChange, lastOilUsed } from "./sticker.js";

const clean = (s) =>
  String(s || "")
    .replace(/\s*\(included\)\s*$/i, "")
    .trim();

export function bayCard(order) {
  const lines = (order && order.lines) || [];

  /* distinct services on the ticket, in the order they were added */
  const services = [];
  const seen = new Set();
  for (const l of lines) {
    if (l.kind === "note") continue;
    const j = clean(l.job);
    const k = j.toLowerCase();
    if (j && !seen.has(k)) {
      seen.add(k);
      services.push(j);
    }
  }

  /* the oil-change highlights */
  let oil = null;
  if (hasOilChange(order)) {
    const isFilter = (l) => /filter/i.test(`${l.description || ""} ${l.number || ""}`);
    const parts = lines.filter((l) => l.kind === "part" && (l.oil || l.packaged));
    const oilParts = parts.filter((l) => !isFilter(l));
    const oilLine = oilParts.length ? oilParts.reduce((a, b) => (Number(b.qty) > Number(a.qty) ? b : a)) : null;
    const filterLine = parts.find(isFilter);
    /* Cars that take more than the package's included quarts get the overage
       on its own line — the same oil part, just not folded into the package.
       Match it back by part id / number so its quarts count toward the total,
       even on tickets written before that line carried the oil flag. */
    const oilIds = new Set();
    for (const l of oilParts) {
      if (l.partId) oilIds.add(`id:${l.partId}`);
      if (l.number) oilIds.add(`no:${String(l.number).toLowerCase()}`);
    }
    const countsAsOil = (l) => {
      if (l.kind !== "part" || isFilter(l)) return false;
      if (l.oil || l.packaged) return true;
      return (l.partId && oilIds.has(`id:${l.partId}`)) || (l.number && oilIds.has(`no:${String(l.number).toLowerCase()}`));
    };
    const totalQuarts = lines.reduce((sum, l) => (countsAsOil(l) && Number(l.qty) > 0 ? sum + Number(l.qty) : sum), 0);
    oil = {
      type: lastOilUsed(order) || (oilLine ? clean(oilLine.description) : ""),
      quarts: totalQuarts > 0 ? Math.round(totalQuarts * 100) / 100 : null,
      filter: filterLine ? clean(filterLine.number) || clean(filterLine.description) : "",
    };
  }

  return { services, oil };
}
