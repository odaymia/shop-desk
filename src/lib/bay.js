/* What the shop-floor bay display shows a tech about the car on the ticket:
   the services being done, and for an oil change the big three — the oil
   type, how many quarts, and which filter. Pure — no React, DOM, or storage. */
import { hasOilChange, lastOilUsed, readsOil } from "./sticker.js";

const clean = (s) =>
  String(s || "")
    .replace(/\s*\(included\)\s*$/i, "")
    .trim();

const isFilter = (l) => /filter/i.test(`${l.description || ""} ${l.number || ""}`);
const isSurcharge = (l) => !!(l.surchargeForId || l.surchargeKind);

/* A friendly label for a standalone part added straight to the ticket (no
   canned job), so the tech reads "Cabin air filter" instead of a part number. */
const partLabel = (l) => {
  const t = `${l.description || ""} ${l.number || ""}`;
  if (/cabin/i.test(t)) return "Cabin air filter";
  if (/air\s*filter/i.test(t)) return "Air filter";
  if (/wiper/i.test(t)) return "Wiper blades";
  return clean(l.description) || "Service";
};

export function bayCard(order) {
  const lines = (order && order.lines) || [];

  /* Everything being done to the car, in the order it was added: each canned
     job by name, plus any loose part (a wiper, an air filter) added on its
     own so it isn't lost. */
  const services = [];
  const seen = new Set();
  const add = (label) => {
    const s = String(label || "").trim();
    const k = s.toLowerCase();
    if (s && !seen.has(k)) {
      seen.add(k);
      services.push(s);
    }
  };
  for (const l of lines) {
    if (l.kind === "note") continue;
    const j = clean(l.job);
    if (j) {
      add(j);
      continue;
    }
    /* a standalone part with no canned job — a loose air filter, wipers, a
       one-off part; packaged parts belong to a job and are named by it */
    if (l.kind === "part" && !l.oil && !l.packaged && !isSurcharge(l)) add(partLabel(l));
  }

  /* The oil-change highlights — only the oil that's part of the oil change,
     never the fluid from a transmission service or radiator flush (those
     ride on their own package line and must not add to the quart count). An
     oil line is flagged oil, or its job reads like an oil change. */
  let oil = null;
  if (hasOilChange(order)) {
    const isOilLine = (l) => l.kind === "part" && !isFilter(l) && !isSurcharge(l) && (l.oil || readsOil(l));
    const oilParts = lines.filter(isOilLine);
    const oilLine = oilParts.length ? oilParts.reduce((a, b) => (Number(b.qty) > Number(a.qty) ? b : a)) : null;
    const filterLine = lines.find(
      (l) => l.kind === "part" && isFilter(l) && (l.oil || (l.packaged && readsOil(l)) || /oil\s*filter/i.test(`${l.description || ""}`)),
    );
    const totalQuarts = oilParts.reduce((sum, l) => (Number(l.qty) > 0 ? sum + Number(l.qty) : sum), 0);
    oil = {
      type: lastOilUsed(order) || (oilLine ? clean(oilLine.description) : ""),
      quarts: totalQuarts > 0 ? Math.round(totalQuarts * 100) / 100 : null,
      filter: filterLine ? clean(filterLine.number) || clean(filterLine.description) : "",
    };
  }

  return { services, oil };
}
