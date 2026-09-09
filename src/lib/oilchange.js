/* Oil change packages: a menu price that includes so many quarts, the
   filter, and a fluid check, with a per-quart charge past that. Pure. */
import { round2 } from "./invoice.js";

export const DEFAULT_OIL_PACKAGES = [
  { id: "conv", name: "Valvoline Conventional Oil Change", price: 54.99, quarts: 5, extraQuart: 4.99, details: "Includes up to 5 quarts of Valvoline conventional oil, oil filter, fluid inspection and top-off." },
  { id: "maxlife", name: "Valvoline MaxLife High Mileage Oil Change", price: 79.99, quarts: 5, extraQuart: 7.99, details: "Includes up to 5 quarts of Valvoline MaxLife high-mileage oil, oil filter, fluid inspection and top-off." },
  { id: "synthetic", name: "Valvoline Full Synthetic Oil Change", price: 99.99, quarts: 5, extraQuart: 9.99, details: "Includes up to 5 quarts of Valvoline full synthetic oil, oil filter, fluid inspection and top-off." },
];

/* Lines for one package on a ticket.
   - the package itself, taxable (the price is "+ tax"), as the labor line
   - the oil at $0 with the real quart count, linked to inventory when
     picked so the bottles come off the shelf
   - the filter at $0, linked when picked
   - extra quarts past the included amount at the package's rate */
export function oilPackageLines(pkg, quarts, oilPart, filterPart, mkId) {
  const q = Math.max(0, Math.round((Number(quarts) || pkg.quarts) * 10) / 10);
  const job = pkg.name;
  const lines = [
    {
      id: mkId(),
      kind: "labor",
      description: pkg.name,
      details: pkg.details || "",
      hours: 1,
      rate: round2(pkg.price),
      unit: "service",
      taxable: true,
      job,
    },
    {
      id: mkId(),
      kind: "part",
      partId: oilPart ? oilPart.id : null,
      number: oilPart ? oilPart.number : "",
      description: oilPart ? oilPart.description : "Motor oil (included)",
      qty: Math.min(q, pkg.quarts) || pkg.quarts,
      price: 0,
      cost: oilPart ? Number(oilPart.cost) || 0 : 0,
      condition: "new",
      taxable: false,
      job,
    },
    {
      id: mkId(),
      kind: "part",
      partId: filterPart ? filterPart.id : null,
      number: filterPart ? filterPart.number : "",
      description: filterPart ? filterPart.description : "Oil filter (included)",
      qty: 1,
      price: 0,
      cost: filterPart ? Number(filterPart.cost) || 0 : 0,
      condition: "new",
      taxable: false,
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
  return lines;
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
