/* Short service codes for a ticket's work, for the quick visit-history list.
   An oil change reads "OIL"; an oil change plus an engine air filter reads
   "OIL, AF"; oil plus a transmission flush plus a coolant flush reads
   "OIL, ATF, RAD".

   Each line on the ticket is classified against the rules below, first match
   wins for that line, and the codes come back in this same listed order so a
   visit always reads the same way regardless of the order lines were added.
   Order matters: the more specific rule must come before a rule it could also
   match — CAF (cabin air filter) before AF (which would also see "air
   filter"), and BF (brake fluid) before BRK (brakes). */
const RULES = [
  ["OIL", [/oil change/, /\blof\b/, /\blube[, ]|^lube$| lube /]],
  ["CAF", [/cabin|pollen|micro.?n? ?air|a\/?c filter|passenger.*(air|filter)|in.?cabin/]],
  ["AF", [/air filter|air cleaner/]],
  ["ATF", [/transmission|\btrans\b|\batf\b|\bcvt\b/]],
  ["RAD", [/coolant|radiator|antifreeze|cooling system/]],
  ["BF", [/brake fluid/]],
  ["BRK", [/brake|rotor|caliper|brake pad|brake shoe/]],
  ["PS", [/power steering/]],
  ["DIFF", [/differential|gear oil|\bdiff\b|axle fluid/]],
  ["TC", [/transfer case/]],
  ["FUEL", [/fuel system|fuel injection|injector|fuel induction/]],
  ["TIRE", [/\btire|mount.*balance|balance.*tire|wheel/]],
  ["ALIGN", [/alignment|\balign\b/]],
  ["BATT", [/battery/]],
  ["AC", [/\ba\/?c\b|air condition|freon|refrigerant|recharge/]],
  ["SP", [/spark plug|tune.?up|ignition coil/]],
  ["WIPER", [/wiper/]],
  ["BULB", [/head\s?light|tail\s?light|\bbulb\b/]],
  ["INSP", [/inspection|smog|safety check|multi.?point/]],
];

/* Imported (ISI LubeSoft) parts carry their original category code, which
   says exactly what the part is even when the printed description is a cryptic
   abbreviation — and a cabin filter's description often reads like an engine
   air filter, so this is the authoritative signal, not the text. */
const LS_CAT = {
  OIL: "OIL", FS: "OIL",
  AF: "AF",
  CAF: "CAF",
  ATF: "ATF", ATS: "ATF", MTS: "ATF",
  CO: "RAD", COF: "RAD", RS: "RAD", RAD: "RAD", CFS: "RAD",
  GO: "DIFF", RDS: "DIFF", FDS: "DIFF",
  PSF: "PS", PSS: "PS",
  BRK: "BRK", BKS: "BRK",
  BF: "BF", BFS: "BF",
  WB: "WIPER", WBT: "WIPER",
  BAT: "BATT",
  LGT: "BULB",
  FIC: "FUEL", FF: "FUEL",
  TCS: "TC",
  TR: "TIRE",
};

/* Classify a line purely by its text (job + description). */
function textCode(line) {
  if (!line || line.kind === "discount" || line.kind === "note" || line.kind === "fee") return null;
  const text = `${line.job || ""} ${line.description || ""}`.toLowerCase();
  if (!text.trim()) return null;
  for (const [code, pats] of RULES) if (pats.some((re) => re.test(text))) return code;
  return null;
}

/* The one code a single ticket line reads as, or null. A part line's category
   wins over its description: the LubeSoft category code first, then the shop's
   own category name, then the free text. */
export function lineCode(line, parts) {
  const p = line && line.partId && parts ? parts[line.partId] : null;
  if (p && p.ls && LS_CAT[p.ls.category]) return LS_CAT[p.ls.category];
  const byText = textCode(line);
  if (byText) return byText;
  if (p && p.category) return textCode({ description: p.category });
  return null;
}

/* The distinct service codes on an order, in canonical order. Pass the shop's
   parts map so imported and coded parts classify by category, not description. */
export function serviceCodes(order, parts) {
  const found = new Set();
  for (const l of order.lines || []) {
    const c = lineCode(l, parts);
    if (c) found.add(c);
  }
  return RULES.filter(([c]) => found.has(c)).map(([c]) => c);
}
