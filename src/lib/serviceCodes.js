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
  ["CAF", [/cabin air|cabin filter|pollen filter/]],
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

/* The one code a single ticket line reads as, or null. */
export function lineCode(line) {
  if (!line || line.kind === "discount" || line.kind === "note" || line.kind === "fee") return null;
  const text = `${line.job || ""} ${line.description || ""}`.toLowerCase();
  if (!text.trim()) return null;
  for (const [code, pats] of RULES) if (pats.some((re) => re.test(text))) return code;
  return null;
}

/* The distinct service codes on an order, in canonical order. */
export function serviceCodes(order) {
  const found = new Set();
  for (const l of order.lines || []) {
    const c = lineCode(l);
    if (c) found.add(c);
  }
  return RULES.filter(([c]) => found.has(c)).map(([c]) => c);
}
