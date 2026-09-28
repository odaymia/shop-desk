/* Filters and wipers from MOTOR (Valvoline aftermarket catalog) → the
   car's service spec. Pure — no React, no storage. The "motor" Edge
   Function returns { engines, parts: [{ type, engineId, position, label,
   numbers }] } for every engine the base vehicle comes with; this picks
   the car's engine and shapes the result for the spec card and the oil
   change picker (whose recommended filter comes from spec.oilFilters). */

const num = (s) => String(s || "").trim();

/* A wiper's size and fit from MOTOR's notes: "24 in." → size 24,
   "Arm Connector: Hook 9x3" → connector, "Original (OEM): Hybrid" → the
   blade style the car came with. */
export function wiperNotes(notes) {
  const out = {};
  for (const t of notes || []) {
    const s = String(t || "").trim();
    const size = s.match(/^(\d{1,2}(?:\.\d)?)\s*(?:in\.?|inch(?:es)?|")$/i) || s.match(/\b(\d{1,2}(?:\.\d)?)\s*(?:in\.?|inch(?:es)?|")(?=\s|$)/i);
    if (size && !out.size) out.size = size[1];
    const conn = s.match(/arm connector:\s*(.+)/i);
    if (conn) out.connector = conn[1].trim();
    const oem = s.match(/original \(oem\):\s*(.+)/i);
    if (oem) out.oemStyle = oem[1].trim();
  }
  return out;
}

/* The wiper sizes a car takes, one per side: { Driver: "24", Passenger: "19" }. */
export function wiperSizes(spec) {
  const out = {};
  for (const w of (spec && spec.wipers) || []) if (w.size && !out[w.side || "Blade"]) out[w.side || "Blade"] = w.size;
  return out;
}

/* Wiper blades in inventory that are one of these sizes, whatever the
   brand: the size read from the part number ("WB-24", "VB24") or the
   description ("Wiper blade 24\"", "24 in"). */
export function wipersBySize(parts, sizes) {
  const want = new Set((sizes || []).map((x) => String(Number(x))));
  if (!want.size) return [];
  const sizeOf = (p) => {
    const t = `${p.description || ""} ${p.number || ""}`;
    const m = t.match(/\b(\d{2})(?:\.\d)?\s*(?:in\b|inch|")/i) || String(p.number || "").match(/(\d{2})(?!\d)/);
    return m ? String(Number(m[1])) : "";
  };
  return Object.values(parts || {}).filter((p) => p && p.active !== false && /wiper/i.test(`${p.category || ""} ${p.description || ""}`) && want.has(sizeOf(p)));
}

/* Which MOTOR engine this car has: the id the VIN decode gave, else the
   one whose displacement and cylinder count match the car's engine text
   ("3.5L V6"), else the only one there is. Null when it can't tell. */
export function pickEngine(engines, { engineId, engineText } = {}) {
  const list = engines || [];
  if (engineId && list.some((e) => String(e.id) === String(engineId))) return String(engineId);
  const t = String(engineText || "").toUpperCase();
  const liters = (t.match(/\b(\d\.\d)\s*L?\b/) || [])[1];
  const cyl = (t.match(/\b[VLIH]-?(\d{1,2})\b|(\d{1,2})[- ]?CYL/) || []).slice(1).find(Boolean);
  const code = list.find((e) => e.code && t.includes(String(e.code).toUpperCase()));
  if (code) return String(code.id);
  const hybrid = /HYBRID|HEV/.test(t);
  const isHybrid = (e) => /HYBRID|HEV/i.test(String(e.description || ""));
  const sized = list.filter((e) => (!liters || String(e.liters) === liters) && (!cyl || String(e.cylinders) === cyl));
  /* same size in gas and hybrid form: the gas one unless the car says hybrid */
  const fits = sized.filter((e) => isHybrid(e) === hybrid).length ? sized.filter((e) => isHybrid(e) === hybrid) : sized;
  if (liters && fits.length >= 1) {
    /* two engines with the same size (K24Z2 / K24Z3) almost always share
       filters; take the first */
    return String(fits[0].id);
  }
  return list.length === 1 ? String(list[0].id) : null;
}

/* The engine's parts as spec fields. Numbers are kept as MOTOR prints
   them ("VO-106"); the inventory match ignores dashes and spaces. */
export function specFromMotorFilters(result, engineId) {
  const parts = ((result && result.parts) || []).filter((p) => !engineId || !p.engineId || String(p.engineId) === String(engineId));
  const list = (type) => {
    const seen = new Set();
    const out = [];
    for (const p of parts.filter((x) => x.type === type))
      for (const n of p.numbers || []) {
        const k = num(n).toUpperCase();
        if (!k || seen.has(k) || /^N\/?S$/.test(k)) continue;
        seen.add(k);
        out.push({ brand: "Valvoline", number: num(n) });
      }
    return out;
  };
  const wipers = [];
  for (const p of parts.filter((x) => x.type === "wiper")) {
    const side = /left/i.test(p.position) ? "Driver" : /right/i.test(p.position) ? "Passenger" : /rear/i.test(p.position) ? "Rear" : p.position || "";
    const items = p.items && p.items.length ? p.items : (p.numbers || []).map((n) => ({ number: n, notes: [] }));
    for (const it of items) {
      const n = num(it.number);
      if (!n || wipers.some((w) => w.number === n && w.side === side)) continue;
      wipers.push({ side, kind: p.label || "", number: n, ...wiperNotes(it.notes) });
    }
  }
  /* types MOTOR lists only as "NS": no part to sell */
  const notServiceable = {};
  for (const t of ["oil", "air", "cabin", "fuel"]) {
    const ps = parts.filter((x) => x.type === t);
    if (ps.length && ps.every((x) => (x.numbers || []).every((n) => /^N\/?S$/i.test(num(n))))) notServiceable[t] = true;
  }
  return { oilFilters: list("oil"), airFilters: list("air"), cabinFilters: list("cabin"), fuelFilters: list("fuel"), wipers, notServiceable };
}

/* Merge into a spec without throwing away what the shop typed: MOTOR's
   numbers fill empty fields and are added to lists that already exist. */
export function mergeMotorFilters(spec, found) {
  const add = (mine, theirs) => {
    const have = new Set((mine || []).map((f) => num(f.number).toUpperCase().replace(/[^A-Z0-9]/g, "")));
    return [...(mine || []), ...(theirs || []).filter((f) => !have.has(num(f.number).toUpperCase().replace(/[^A-Z0-9]/g, "")))];
  };
  return {
    ...spec,
    oilFilters: add(spec.oilFilters, found.oilFilters),
    airFilters: add(spec.airFilters, found.airFilters),
    cabinFilters: add(spec.cabinFilters, found.cabinFilters),
    fuelFilters: add(spec.fuelFilters, found.fuelFilters),
    /* a fresh MOTOR answer replaces the wiper list (it carries sizes) */
    wipers: (found.wipers && found.wipers.length ? found.wipers : spec.wipers) || [],
    notServiceable: { ...(spec.notServiceable || {}), ...(found.notServiceable || {}) },
    motorFiltersAt: Date.now(),
  };
}

/* "NS" (or N/S) in MOTOR's part number means there's no serviceable part,
   e.g. a fuel filter built into the in-tank pump. */
export const isNotServiceable = (n) => /^n\/?s$/i.test(String(n || "").trim());

/* The spec's part numbers for an inventory category, so the part picker
   can put the right filter or blade on top: "Engine Air Filters" → the
   air filters, "Cabin Air Filters" → cabin, fuel, wipers, oil filters. */
export function specNumbersFor(spec, category) {
  if (!spec) return [];
  const c = String(category || "").toLowerCase();
  let list = [];
  if (/cabin/.test(c)) list = spec.cabinFilters;
  else if (/fuel/.test(c)) list = spec.fuelFilters;
  else if (/wiper/.test(c)) list = (spec.wipers || []).map((w) => ({ number: w.number }));
  else if (/oil/.test(c)) list = spec.oilFilters;
  else if (/air/.test(c)) list = spec.airFilters;
  return (list || []).filter((f) => f && f.number && !isNotServiceable(f.number));
}
