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
    const parts = lines.filter((l) => l.kind === "part" && (l.oil || l.packaged));
    const oilParts = parts.filter((l) => !/filter/i.test(`${l.description || ""} ${l.number || ""}`));
    const oilLine = oilParts.length ? oilParts.reduce((a, b) => (Number(b.qty) > Number(a.qty) ? b : a)) : null;
    const filterLine = parts.find((l) => /filter/i.test(`${l.description || ""} ${l.number || ""}`));
    oil = {
      type: lastOilUsed(order) || (oilLine ? clean(oilLine.description) : ""),
      quarts: oilLine && Number(oilLine.qty) > 0 ? Number(oilLine.qty) : null,
      filter: filterLine ? clean(filterLine.number) || clean(filterLine.description) : "",
    };
  }

  return { services, oil };
}
