/* Oil change packages: a menu price that includes so many quarts, the
   filter, and a fluid check, with a per-quart charge past that. Pure. */
import { round2 } from "./invoice.js";

export const DEFAULT_OIL_PACKAGES = [
  { id: "conv", name: "Valvoline Conventional Oil Change", price: 54.99, quarts: 5, extraQuart: 4.99, details: "Includes up to 5 quarts of Valvoline conventional oil, oil filter, fluid inspection and top-off." },
  { id: "maxlife", name: "Valvoline MaxLife High Mileage Oil Change", price: 79.99, quarts: 5, extraQuart: 7.99, details: "Includes up to 5 quarts of Valvoline MaxLife high-mileage oil, oil filter, fluid inspection and top-off." },
  { id: "synthetic", name: "Valvoline Full Synthetic Oil Change", price: 99.99, quarts: 5, extraQuart: 9.99, details: "Includes up to 5 quarts of Valvoline full synthetic oil, oil filter, fluid inspection and top-off." },
];

/* Lines for one package on a ticket.

   California taxes the oil and filter (tangible parts) but not the labor,
   so the fixed package price is split: the oil and filter carry their
   inventory retail price and are taxable, and whatever is left of the
   package price is the service labor, which is not taxed. The customer's
   package price is unchanged; only the tax base is the parts. A part with
   no retail price on file adds nothing to the tax (price it under
   Inventory). Extra quarts past the included amount are taxable oil.

   - the service labor line (package price minus the parts), not taxed
   - the oil at its retail price, taxable, linked to inventory when picked
   - the filter at its retail price, taxable, linked when picked
   - extra quarts past the included amount at the package's per-quart rate */
export function oilPackageLines(pkg, quarts, oilPart, filterPart, mkId) {
  const q = Math.max(0, Math.round((Number(quarts) || pkg.quarts) * 10) / 10);
  const incQ = Math.min(q, pkg.quarts) || pkg.quarts;
  const job = pkg.name;
  const pkgPrice = round2(pkg.price);

  const oilEach = oilPart ? round2(Number(oilPart.price) || 0) : 0;
  const filterRetail = filterPart ? round2(Number(filterPart.price) || 0) : 0;
  let oilPrice = oilEach;
  let filterPrice = filterRetail;
  const partsAmt = round2(round2(oilEach * incQ) + filterRetail);
  let laborAmt = round2(pkgPrice - partsAmt);
  if (laborAmt < 0 && partsAmt > 0) {
    /* the parts list for more than the package price (a loss leader):
       scale them to the package so the total still ties out, no labor */
    const f = pkgPrice / partsAmt;
    oilPrice = round2(oilEach * f);
    filterPrice = round2(pkgPrice - round2(oilPrice * incQ));
    laborAmt = 0;
  }

  const lines = [
    {
      id: mkId(),
      kind: "labor",
      description: pkg.name,
      details: pkg.details || "",
      hours: 1,
      rate: laborAmt,
      unit: "service",
      taxable: false,
      packaged: true, // fold into one package line on the printed receipt
      job,
    },
    {
      id: mkId(),
      kind: "part",
      partId: oilPart ? oilPart.id : null,
      number: oilPart ? oilPart.number : "",
      description: oilPart ? oilPart.description : "Motor oil (included)",
      qty: incQ,
      price: oilPrice,
      cost: oilPart ? Number(oilPart.cost) || 0 : 0,
      condition: "new",
      taxable: true,
      packaged: true,
      job,
    },
    {
      id: mkId(),
      kind: "part",
      partId: filterPart ? filterPart.id : null,
      number: filterPart ? filterPart.number : "",
      description: filterPart ? filterPart.description : "Oil filter (included)",
      qty: 1,
      price: filterPrice,
      cost: filterPart ? Number(filterPart.cost) || 0 : 0,
      condition: "new",
      taxable: true,
      packaged: true,
      job,
    },
  ];
  const extra = round2(q - pkg.quarts);
  if (extra > 0) {
    lines.push({
      id: mkId(),
      kind: "part",
      partId: oilPart ? oilPart.id : null,
      number: oilPart ? oilPart.number : "",
      description: `Extra oil over ${pkg.quarts} qt${oilPart ? ` — ${oilPart.description}` : ""}`,
      qty: extra,
      price: round2(pkg.extraQuart),
      cost: oilPart ? Number(oilPart.cost) || 0 : 0,
      condition: "new",
      taxable: true,
      job,
    });
  }
  /* a pricier oil (bottled, boxed) or filter (canister/cartridge) can
     carry a surcharge added on top of the package price — its own taxable
     line, not folded in */
  const surchargeLine = (part, fallback) => {
    const amt = part ? round2(Number(part.surcharge) || 0) : 0;
    if (amt <= 0) return;
    lines.push({
      id: mkId(),
      kind: "part",
      partId: null,
      number: part.number || "",
      description: (part.surchargeLabel || "").trim() || `${part.description || fallback} charge`,
      qty: 1,
      price: amt,
      cost: 0,
      condition: "new",
      taxable: true,
      job,
    });
  };
  surchargeLine(oilPart, "Oil");
  surchargeLine(filterPart, "Filter");
  return lines;
}

/* What kind of oil a name reads like: conventional, blend, synthetic, or
   maxlife (high-mileage). Order matters — "synthetic blend" is a blend,
   "high mileage" wins over the rest. Returns null when no type word is
   present. */
export function detectOilType(text) {
  const s = String(text || "").toLowerCase();
  if (/diesel|\bhdeo\b|\bhdd\b/.test(s)) return "diesel";
  if (/euro|european/.test(s)) return "euro";
  if (/high.?mileage|max.?life/.test(s)) return "maxlife";
  if (/blend/.test(s)) return "blend";
  if (/full.?synthetic|synthetic|\bsyn\b|\bfs\b/.test(s)) return "synthetic";
  if (/conventional|\bconv\b|\bdino\b/.test(s)) return "conventional";
  return null;
}
/* The oil types the inventory dropdown offers. */
export const OIL_TYPE_OPTIONS = [
  ["conventional", "Conventional Oil"],
  ["blend", "Synthetic Blend"],
  ["synthetic", "Full Synthetic Oil"],
  ["diesel", "Diesel Oil"],
  ["euro", "European Synthetic Oil"],
];
/* An oil's type for filtering: the type set on the part wins; otherwise
   read it from the name, and a plain grade counts as conventional. */
export function oilTypeOf(part) {
  if (part && part.oilType) return part.oilType;
  return detectOilType(`${(part && part.description) || ""} ${(part && part.category) || ""}`) || "conventional";
}
/* The oil type a package calls for, from its name or id. Null when the
   package name says nothing about the oil (a generic package), so its
   oil list isn't filtered. */
export function packageOilType(pkg) {
  return detectOilType(`${(pkg && pkg.id) || ""} ${(pkg && pkg.name) || ""}`);
}
/* Which oil types a package accepts. A European synthetic counts as a
   full synthetic; a high-mileage (MaxLife) package takes blends and
   synthetics too, since that oil comes in both. */
const OIL_COMPAT = {
  conventional: ["conventional"],
  blend: ["blend"],
  synthetic: ["synthetic", "euro"],
  euro: ["euro"],
  maxlife: ["maxlife", "blend", "synthetic"],
  diesel: ["diesel"],
};
/* The oils that fit a package: only the matching type(s). A conventional
   package won't list synthetic or blend; a synthetic package won't list
   conventional. */
export function oilsForPackage(oils, pkg) {
  const want = packageOilType(pkg);
  if (!want) return oils;
  const ok = OIL_COMPAT[want] || [want];
  return (oils || []).filter((p) => ok.includes(oilTypeOf(p)));
}

/* Inventory items that are motor oil: category says oil, or the
   description reads like a grade. */
export function oilItems(parts) {
  return Object.values(parts || {}).filter(
    (p) => p.active !== false && !p.tire && (/\boil\b/i.test(String(p.category || "")) || /\b\d{1,2}W-?\d{2}\b/i.test(String(p.description || "")))
  );
}
export function filterItems(parts) {
  return Object.values(parts || {}).filter((p) => p.active !== false && !p.tire && /filter/i.test(`${p.category || ""} ${p.description || ""}`));
}
