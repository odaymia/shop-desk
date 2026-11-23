/* Factory fluid specs and service intervals, from the shop's own research in
   owner's manuals and the manufacturer's maintenance guides. The data files
   live in src/data/oem (built by tools/oemdata/build.py from the research
   workbook) and are loaded on demand, per make.

   The research is careful about what each number means, and so is this:

   - A row applies to a "configuration" written in words ("2.5L 2AR-FE gas
     FWD 6AT", "AWD only", "with factory Tow Package"). parseScope reads what
     it can from those words; applies() compares it with what is known about
     the car and answers yes, maybe or no.
   - A value is used automatically (to prefill the oil change, or as the
     manufacturer interval on the service review) only when it is
     unambiguous for this car: every row that could apply agrees, and the
     rows cover whatever about the car is still unknown. Otherwise it is
     shown, with its condition, and a person decides.
   - A capacity is only an oil-change quantity when the manual gives it as
     one (engine oil, filter changed). System and reference capacities are
     displayed with the manual's own wording and never prefilled.
   - An inspection is never turned into a replacement, and a schedule for
     special use (towing, dust, short trips) is kept apart from normal use.
   - Rows marked unverified are shown as such and never used automatically.

   Pure: no React, no storage. */

const LOADERS = { toyota: () => import("../data/oem/toyota.json") };
const cache = {};
const key = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]/g, "");
export const hasOemData = (make) => !!LOADERS[key(make)];
export async function loadOemData(make) {
  const k = key(make);
  if (!LOADERS[k]) return null;
  if (!cache[k]) cache[k] = (await LOADERS[k]()).default;
  return cache[k];
}

/* ---------- reading a configuration ---------- */
const ENGINE_CODE = /\b([A-Z0-9]{2,5}-[A-Z]{2,4}|B[45][68]B\d{2}O\d|FA2[04])\b/g;
const QUALIFIER = /tow|package|production|lock|pzev|except|only [A-Z]{3}\d|reservoir|oil cooler|radiator|cab\b|edition|generation|lsd|verify|vin|rear a\/c|prerunner|without|\bwith\b|california|type [ab]\b|schedule|synthetic/i;

/* What a configuration says, as sets: an empty set means "doesn't say". */
export function parseScope(text) {
  const t = String(text || "");
  const disp = new Set((t.match(/\d\.\d(?=\s?L\b)/g) || []).map(String));
  const codes = new Set((t.match(ENGINE_CODE) || []).filter((c) => /\d/.test(c)));
  const drive = new Set();
  if (/\b(FWD|RWD|2WD|4x2)\b/i.test(t)) drive.add("2wd");
  if (/\b(AWD|4WD|4x4)\b/i.test(t) || /AWD-[ie]\b|e-AWD/i.test(t)) drive.add("awd");
  const trans = new Set();
  if (/\b(\d{1,2}AT|automatic|e?CVT|ECT)\b/i.test(t)) trans.add("auto");
  if (/\b(\d{1,2}MT|manual)\b/i.test(t)) trans.add("manual");
  const fuel = /hybrid|\bP?HEV\b|plug-?in|prime|e-AWD|eCVT|i-FORCE MAX|-FX[ES]\b/i.test(t) ? "hybrid" : /battery-electric|\bBEV\b|fuel cell|\bFCEV\b/i.test(t) ? "ev" : /\bgas(oline)?\b/i.test(t) ? "gas" : "";
  /* "AWD only", "if equipped": for some cars of this model and not others,
     even when the rest of the research never names the other kind */
  const only = /\bonly\b|if equipped|equipped with/i.test(t);
  return { text: t, disp, codes, drive, trans, fuel, only, qualified: QUALIFIER.test(t) };
}

/* ---------- what is known about the car ----------
   `pick` is what a person chose for this car, on the ticket or when adding
   it, saved on the vehicle as `oem`: { listing, engine, code, fuel, drive,
   trans } (engine is the displacement, code the engine code when there is
   one, fuel "gas" or "hybrid"). */
export function carTraits(vehicle, pick) {
  const v = vehicle || {};
  const p = pick || v.oem || {};
  const detail = [v.ls && v.ls.aces, v.motor && v.motor.engine].filter(Boolean).join(" ");
  const text = [v.model, v.submodel, v.engine, detail].filter(Boolean).join(" ");
  const disp = String(p.engine || (String(v.engine || "").match(/\d\.\d(?=\s?L\b)/) || [])[0] || (detail.match(/\d\.\d(?=\s?L\b)/) || [])[0] || "");
  const codes = new Set([...(detail.match(ENGINE_CODE) || []), ...(String(v.engine || "").match(ENGINE_CODE) || []), ...(p.code ? [String(p.code)] : [])].filter((c) => /\d/.test(c)));
  /* a hybrid says so somewhere; a detailed engine description that doesn't
     is a gas engine; with nothing detailed, it isn't known */
  const hybridHint = /hybrid|prime\b|plug-?in|-FX[ES]\b|\bP?HEV\b|\bFHEV\b/i.test(text);
  const hybrid = p.fuel === "hybrid" ? true : p.fuel === "gas" ? false : hybridHint ? true : detail ? false : null;
  const drive = p.drive || (/\b(AWD|4WD|4x4)\b/i.test(text) ? "awd" : /\b(FWD|RWD|2WD)\b/i.test(text) ? "2wd" : "");
  const trans = p.trans || "";
  return { disp, codes, hybrid, drive, trans };
}

/* Does a row with this scope apply to the car? { fit: "yes"|"maybe"|"no",
   open: the things about the car that would have to be known to say }. */
export function applies(scope, traits) {
  const open = [];
  if (scope.disp.size) {
    if (traits.disp) {
      if (!scope.disp.has(traits.disp)) return { fit: "no", open };
    } else open.push("engine");
  }
  if (scope.codes.size && traits.codes.size && ![...scope.codes].some((c) => traits.codes.has(c))) return { fit: "no", open };
  if (scope.fuel === "hybrid" || scope.fuel === "gas") {
    if (traits.hybrid === null) open.push("fuel");
    else if ((scope.fuel === "hybrid") !== traits.hybrid) return { fit: "no", open };
  }
  if (scope.drive.size === 1) {
    if (traits.drive) {
      if (!scope.drive.has(traits.drive)) return { fit: "no", open };
    } else open.push("drive");
  }
  if (scope.trans.size === 1) {
    if (traits.trans) {
      if (!scope.trans.has(traits.trans)) return { fit: "no", open };
    } else open.push("trans");
  }
  /* `hard`: nothing but knowing the car settles it */
  return { fit: open.length || scope.qualified ? "maybe" : "yes", open, hard: scope.only && open.length > 0 };
}

/* ---------- which listing is this car ----------
   The research lists a hybrid apart from its gas sibling ("Camry",
   "Camry Hybrid"), and a shop often files both under the same model. */
export function oemListings(data, vehicle) {
  const year = data && data.years && data.years[String(vehicle && vehicle.year)];
  const want = key(vehicle && vehicle.model);
  if (!year || !want) return [];
  const names = Object.keys(year);
  const exact = names.filter((n) => key(n) === want);
  const wider = names.filter((n) => key(n) !== want && (key(n).startsWith(want) || want.startsWith(key(n))));
  /* "Sienna Van" is a Sienna; but a plain "Prius" is not a "Prius c" */
  const longer = wider.filter((n) => want.startsWith(key(n))).sort((a, b) => b.length - a.length);
  const variants = wider.filter((n) => key(n).startsWith(want)).sort();
  return exact.length ? [...exact, ...variants] : longer.length ? [longer[0]] : variants;
}
const isHybridName = (n) => /hybrid|prime|plug-?in|i-FORCE MAX/i.test(n);

/* The listing to show, and whether that choice is settled. A car filed
   under the plain model is that listing, unless it's a hybrid and the
   research has "<model> Hybrid", or its trim names another listing
   ("Prius" with trim "Prime"). When it can't be told whether the car is the
   hybrid, the choice is left open for a person. */
export function pickListing(data, vehicle, pick) {
  const names = oemListings(data, vehicle);
  const p = pick || (vehicle && vehicle.oem) || {};
  if (!names.length) return { names, listing: "", sure: false };
  if (p.listing && names.includes(p.listing)) return { names, listing: p.listing, sure: true };
  if (names.length === 1) return { names, listing: names[0], sure: true };
  const t = carTraits(vehicle, p);
  const want = key(vehicle.model);
  const exact = names.find((n) => key(n) === want) || "";
  const hybridSibling = names.find((n) => key(n) === `${want}hybrid`) || "";
  /* a trim that names a listing: "Prime", "Hatchback", "Plug-in" */
  const trim = key([vehicle.submodel, vehicle.engine].filter(Boolean).join(" "));
  const byTrim = names.filter((n) => n !== exact && n !== hybridSibling && trim && trim.includes(key(n).slice(want.length)) && key(n).slice(want.length).length > 2);
  if (byTrim.length === 1) return { names, listing: byTrim[0], sure: true };
  if (hybridSibling) {
    if (t.hybrid === true) return { names, listing: hybridSibling, sure: true };
    if (t.hybrid === false && exact) return { names, listing: exact, sure: true };
    return { names, listing: exact || hybridSibling, sure: false };
  }
  if (exact) return { names, listing: exact, sure: true };
  return { names, listing: names[0], sure: false };
}

/* ---------- what each row is about ---------- */
const VERIFIED = /^(toyota source|oem manual mirror|oem guide mirror|toyota-authored mirror)$/i;
const NOT_APPLICABLE = /^(not applicable|n\/a)$/i;
/* The research says a car has no such fluid in a few ways: in the status,
   in the spec ("Not applicable; electric power steering"), or in the volume
   note ("No hydraulic reservoir"). "Capacity not published" is not one of
   them: that fluid exists, the manual just doesn't give an amount. */
const NO_SUCH_FLUID = /^(not applicable|n\/a\b|no hydraulic|no separate)/i;

/* The desk's service a fluid or interval row belongs to: the ids of the
   standard service list (serviceReview.js), or a name of its own. */
export function serviceIdOf(name) {
  const n = String(name || "").toLowerCase();
  if (/engine oil/.test(n)) return "oil";
  if (/spark plug/.test(n)) return "sparkPlugs";
  if (/brake fluid/.test(n)) return "brakeFluid";
  if (/power steering/.test(n)) return "psFluid";
  if (/clutch/.test(n)) return "clutch";
  if (/coolant/.test(n)) return /inverter|intercooler|power.?control|battery|fuel cell|traction|stack/.test(n) ? "otherCoolant" : "coolant";
  if (/transfer/.test(n)) return "transfer";
  if (/differential|rear electric drive|rear drive unit/.test(n)) return "diff";
  if (/transmission|transaxle|cvt/.test(n)) return "trans";
  return "other";
}
/* Where a fluid sits on the card, top to bottom. */
const FLUID_ORDER = ["oil", "trans", "diff", "transfer", "coolant", "otherCoolant", "brakeFluid", "psFluid", "clutch", "other"];

/* Is a schedule row for everyday driving or for special use? Toyota's
   charts say; the research carries that in the notes. */
const SPECIAL_USE = /tow|car-top|roof.?carrier|heavy.?load|loading|dust|dirt|off-road|special (operating|condition)|severe|short trips|repeated trips|taxi|police|idling|low.?speed|e85|ethanol|delivery|schedule b|not used at (the )?(previous|last)|was not used/i;
export function useOf(notes) {
  const n = String(notes || "").trim();
  if (/^(explicit |scheduled )?normal\b/i.test(n)) return "normal";
  if (SPECIAL_USE.test(n)) return "special";
  return "normal"; // an unqualified chart entry is the everyday schedule
}

/* ---------- one car's view of the data ---------- */
export function oemView(data, vehicle, pick) {
  if (!data || !vehicle) return null;
  const L = pickListing(data, vehicle, pick);
  if (!L.listing) return null;
  const S = data.strings;
  const entry = data.years[String(vehicle.year)][L.listing];
  const traits = carTraits(vehicle, pick);
  const scopeCache = new Map();
  const scopeOf = (i) => {
    if (!scopeCache.has(i)) scopeCache.set(i, parseScope(S[i]));
    return scopeCache.get(i);
  };
  const all = [...entry.f, ...entry.s].map((r) => scopeOf(r[0]));
  /* once the listing is settled, so is whether it's a hybrid: the listing
     is all one kind (a Prius, a 2021 Sienna), or it's named for it */
  if (L.sure && traits.hybrid === null) {
    const fuels = new Set(all.map((sc) => sc.fuel).filter((f) => f === "hybrid" || f === "gas"));
    traits.hybrid = isHybridName(L.listing) ? true : fuels.size === 1 ? fuels.has("hybrid") : null;
  }
  /* A listing whose rows only ever say "FWD" is a front-drive car, and one
     that only ever names an automatic has no manual: that much is known
     without asking. Never the other way for drive: rows marked "AWD only"
     exist precisely because some of these cars aren't. */
  const naming = (dim) => all.filter((sc) => sc[dim].size === 1);
  if (L.sure && !traits.drive) {
    const m = naming("drive");
    if (m.length && m.every((sc) => sc.drive.has("2wd") && !sc.only)) traits.drive = "2wd";
  }
  if (L.sure && !traits.trans) {
    const m = naming("trans");
    const kinds = new Set(m.flatMap((sc) => [...sc.trans]));
    if (m.length && kinds.size === 1 && !m.some((sc) => sc.only)) traits.trans = [...kinds][0];
  }
  /* what the rows of this listing distinguish, for the choices on the card */
  const facet = (dim) => {
    const seen = new Set();
    for (const sc of all) if (sc[dim].size === 1 || dim === "disp") for (const x of sc[dim]) seen.add(x);
    return [...seen].sort();
  };
  const facets = { engines: facet("disp"), drives: facet("drive"), trans: facet("trans") };
  const tag = (r, scope) => ({ scope: scope.text, sc: scope, ...applies(scope, traits) });
  const fluids = entry.f
    .map((r) => {
      const scope = scopeOf(r[0]);
      const status = S[r[5]];
      return { ...tag(r, scope), component: S[r[1]], id: serviceIdOf(S[r[1]]), spec: S[r[2]], qt: r[3], basis: S[r[4]], status, page: S[r[6]], verified: VERIFIED.test(status), na: NOT_APPLICABLE.test(status) || NO_SUCH_FLUID.test(S[r[2]]) || (r[3] == null && NO_SUCH_FLUID.test(S[r[4]])) };
    })
    .filter((r) => r.fit !== "no");
  const services = entry.s
    .map((r) => {
      const scope = scopeOf(r[0]);
      const status = S[r[8]];
      const action = S[r[2]];
      return { ...tag(r, scope), service: S[r[1]], id: serviceIdOf(S[r[1]]), action, firstMiles: r[3], firstMonths: r[4], repeatMiles: r[5], repeatMonths: r[6], notes: S[r[7]], use: useOf(S[r[7]]), status, page: S[r[9]], verified: VERIFIED.test(status), na: NOT_APPLICABLE.test(status) || NOT_APPLICABLE.test(action) };
    })
    .filter((r) => r.fit !== "no");
  fluids.sort((a, b) => FLUID_ORDER.indexOf(a.id) - FLUID_ORDER.indexOf(b.id));
  return { make: data.make, year: String(vehicle.year), listing: L.listing, listings: L.names, sure: L.sure, traits, facets, fluids, services };
}

/* ---------- using a value only when it is unambiguous ----------
   `rows` could all apply to the car. They settle a value when they agree on
   it. That is enough for something every car has (engine oil, coolant,
   brake fluid, spark plugs, a transmission): the words "FWD" or "CVT" on
   the only oil row for an engine describe the car, they don't put the oil
   in doubt. For something only some cars have (a differential, a transfer
   case, power steering fluid) the rows must also cover whatever about the
   car is still unknown: a FWD row and an AWD row with the same number, or
   a row that doesn't depend on it at all. "AWD only" never covers a car
   whose drive isn't known. */
const EVERY_CAR_HAS = new Set(["oil", "coolant", "brakeFluid", "sparkPlugs", "trans"]);
function settled(view, rows, valueOf) {
  if (!view.sure || !rows.length) return null;
  const vals = new Set(rows.map((r) => JSON.stringify(valueOf(r))));
  if (vals.size !== 1) return null;
  if (rows.some((r) => r.fit === "yes")) return valueOf(rows[0]);
  if (rows.some((r) => r.hard)) return null;
  if (rows.every((r) => EVERY_CAR_HAS.has(r.id)) && !rows.some((r) => r.open.includes("fuel") || r.open.includes("engine"))) return valueOf(rows[0]);
  /* every row is conditional: do they cover what is unknown? */
  const dims = { engine: ["disp", view.facets.engines], drive: ["drive", view.facets.drives], trans: ["trans", view.facets.trans] };
  for (const [name, [dim, all]] of Object.entries(dims)) {
    if (!rows.some((r) => r.open.includes(name))) continue;
    if (rows.some((r) => !r.open.includes(name) && !r.sc[dim].size)) continue;
    const got = new Set();
    for (const r of rows) for (const x of r.sc[dim]) got.add(x);
    if (!all.every((x) => got.has(x))) return null;
  }
  if (rows.some((r) => r.open.includes("fuel"))) return null;
  /* rows that differ only by a qualifier (production date, tow package)
     and still agree are fine; a lone qualified row is not */
  const unq = rows.filter((r) => !r.sc.qualified);
  if (!unq.length && rows.length < 2) return null;
  return valueOf(rows[0]);
}

const gradeOf = (spec) => (String(spec || "").match(/\b\d{1,2}W-\d{1,2}\b/) || [])[0] || "";
const oilSpecOf = (spec) => (String(spec || "").match(/\b(ILSAC GF-\d[AB]?|API S[A-Z](?:\/RC)?|JASO GLV-\d|dexos\d?)\b/i) || [])[0] || "";

/* The oil change for this car: grade and the with-filter quantity, when the
   manual gives exactly one answer. { grade, qt, spec, basis, page } or null. */
export function oemOilSpec(view) {
  if (!view) return null;
  const rows = view.fluids.filter((r) => r.id === "oil" && /filter changed|^engine oil$/i.test(r.component) && r.verified && r.qt > 0 && gradeOf(r.spec));
  const v = settled(view, rows, (r) => [gradeOf(r.spec), r.qt]);
  if (!v) return null;
  const r = rows[0];
  return { grade: v[0], qt: v[1], spec: oilSpecOf(r.spec), basis: r.basis, page: r.page };
}

const REPLACE = /^replace$/i;
/* The schedule in the shape the service review already merges (the same
   fields a MOTOR schedule arrives in), one entry per desk service:
   { forId, name, serviceType, miles, months, repeatMiles, repeatMonths,
   severeMiles, severeMonths }. Only what is settled for this car, and only
   replacements: a row that says to inspect is not an interval to sell
   against, so it never reaches the service review. Also the services the
   manual says this car doesn't have. */
export function oemSchedule(view) {
  if (!view) return { services: [], notOnCar: [], source: "" };
  const out = [];
  const ids = [...new Set(view.services.map((r) => r.id))].filter((id) => id !== "other" && id !== "otherCoolant");
  const interval = (r) => [r.firstMiles || 0, r.firstMonths || 0, r.repeatMiles || 0, r.repeatMonths || 0];
  for (const id of ids) {
    const mine = view.services.filter((r) => r.id === id && r.verified && !r.na);
    const timed = (r) => (r.firstMiles || r.firstMonths || r.repeatMiles || r.repeatMonths) > 0;
    const normal = settled(view, mine.filter((r) => REPLACE.test(r.action) && r.use === "normal" && timed(r)), interval);
    const special = settled(view, mine.filter((r) => REPLACE.test(r.action) && r.use === "special" && timed(r)), interval);
    const name = (view.services.find((r) => r.id === id) || {}).service || id;
    if (normal || special) {
      const n = normal || [0, 0, 0, 0];
      const sp = special || [0, 0, 0, 0];
      out.push({ forId: id, name: `${name} Replace`, serviceType: "Replace", miles: n[0], months: n[1], repeatMiles: n[2], repeatMonths: n[3], severeMiles: sp[0], severeMonths: sp[1], severeRepeatMiles: sp[2], severeRepeatMonths: sp[3] });
    }
  }
  return { services: out, notOnCar: oemNotOnCar(view), source: view.make };
}

/* Services the manual says this car has no fluid for (electric power
   steering, no differential to service). Only when every row that could
   apply says so, by the same test as any other value: it must not hinge on
   something still unknown about the car. */
export function oemNotOnCar(view) {
  if (!view || !view.sure) return [];
  const out = [];
  for (const id of ["psFluid", "diff"]) {
    const rows = [...view.fluids.filter((r) => r.id === id), ...view.services.filter((r) => r.id === id)];
    /* a row that says "none" is taken at its word whether or not its source
       is a mirror; a row that says there is one keeps the service on */
    if (rows.length && rows.every((r) => r.na) && settled(view, rows, () => "none")) out.push(id);
  }
  return out;
}

/* "4.6 qt" */
export const qtText = (q) => (q == null || q === "" ? "" : `${q} qt`);

/* ---------- the lists for adding a car ----------
   Model, then that model's engines and types, straight from the research.
   The research files a hybrid apart from its gas sibling ("Camry",
   "Camry Hybrid"); here it is one model whose engine list has both, the way
   a counter person thinks of it. */
const TYPE_SUFFIX = /\s+(Plug-in Hybrid|Hybrid|Prime|i-FORCE MAX|EV)$/i;
const baseModel = (listing) => String(listing || "").replace(TYPE_SUFFIX, "");
const researchedYear = (data, year) => (data && data.years && data.years[String(year)]) || null;

/* Does the research cover this make's cars of this year at all? */
export const oemCoversYear = (data, year) => !!researchedYear(data, year);

/* The models of a year, A to Z. */
export function oemModels(data, year) {
  const y = researchedYear(data, year);
  if (!y) return [];
  return [...new Set(Object.keys(y).map(baseModel))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/* Cylinders, from what the configuration says or the engine family. */
const CYL_BY_CODE = [
  [/^(G16E|M15A)/, 3],
  [/^(1NZ|\dZR|\dAR|A25A|M20A|T24A|\dTR|FA2[04]|B46)/, 4],
  [/^(\dGR|V35A|B58)/, 6],
  [/^(\dUR|\dUZ)/, 8],
];
function cylinders(code, text) {
  const hit = CYL_BY_CODE.find(([re]) => re.test(code || ""));
  if (hit) return hit[1];
  const m = String(text || "").match(/\b(?:V|I|L)(\d{1,2})\b/);
  return m ? Number(m[1]) : 0;
}
const typeOf = (listing, text, code) =>
  /plug-?in|prime|\bPHEV\b/i.test(`${listing} ${text}`)
    ? "Plug-in Hybrid"
    : /hybrid|\bHEV\b|i-FORCE MAX|e-AWD|eCVT/i.test(`${listing} ${text}`) || /-FX[ES]$/.test(code || "")
      ? "Hybrid"
      : /fuel cell|\bFCEV\b/i.test(text) || /mirai/i.test(listing)
        ? "Fuel cell"
        : /battery-electric|\bBEV\b/i.test(text) || /\bEV$|bZ4X/i.test(listing)
          ? "Electric"
          : "";
const TYPE_ORDER = ["", "Hybrid", "Plug-in Hybrid", "Electric", "Fuel cell"];

/* The engines and types of a model in a year:
   [{ label, listing, engine (displacement), code, type, fuel }], smallest first,
   gas before hybrid. `label` is what goes in the car's Engine field
   ("2.5L 4-cyl", "2.5L 4-cyl Hybrid"); the rest is saved with the car so the
   factory specs know exactly which rows are its own. */
export function oemEngineOptions(data, year, model) {
  const y = researchedYear(data, year);
  const want = key(model);
  if (!y || !want) return [];
  const S = data.strings;
  const found = new Map();
  for (const [listing, entry] of Object.entries(y)) {
    if (key(baseModel(listing)) !== want) continue;
    const texts = [...new Set([...entry.f, ...entry.s].map((r) => S[r[0]]))];
    const mine = [];
    for (const t of texts) {
      const sc = parseScope(t);
      /* a displacement and the engine code written right after it belong together */
      const pairs = [...t.matchAll(/(\d\.\d)\s?L\b([^;,/]*?)\b([A-Z0-9]{2,5}-[A-Z]{2,4}|B[45][68]B\d{2}O\d|FA2[04])\b/g)].filter((m) => /\d/.test(m[3]) && !/\d\.\d\s?L/.test(m[2]));
      for (const m of pairs) mine.push({ disp: m[1], code: m[3], text: t });
      const paired = new Set(pairs.map((m) => m[1]));
      for (const d of sc.disp) if (!paired.has(d)) mine.push({ disp: d, code: "", text: t });
      /* an engine code written alone ("3UR-FE / 3UR-FBE V8" after one size) */
      if (sc.disp.size === 1) for (const c of sc.codes) if (!pairs.some((m) => m[3] === c)) mine.push({ disp: [...sc.disp][0], code: c, text: t });
    }
    const withCode = new Set(mine.filter((e) => e.code).map((e) => e.disp));
    const engines = mine.filter((e) => e.code || !withCode.has(e.disp));
    if (!engines.length) {
      const type = typeOf(listing, texts.join(" "), "");
      found.set(`${listing}||`, { listing, engine: "", code: "", type: type || "Electric", cyl: 0 });
      continue;
    }
    for (const e of engines) {
      /* a gas engine and a hybrid of the same size under one listing (the
         2024 Tacoma) are two choices; with an engine code the code decides */
      const type = typeOf(listing, e.code ? "" : e.text, e.code) || (e.code ? typeOf(listing, e.text, e.code) : "");
      const k = `${listing}|${e.disp}|${e.code}|${e.code ? "" : type}`;
      if (!found.has(k)) found.set(k, { listing, engine: e.disp, code: e.code, type, cyl: cylinders(e.code, e.text) });
    }
  }
  const list = [...found.values()];
  /* an engine written without its code borrows the cylinder count of the
     same-size engine elsewhere in that year's lineup, when there's one answer */
  const cylBySize = {};
  for (const entry of Object.values(y)) {
    for (const t of new Set([...entry.f, ...entry.s].map((r) => S[r[0]]))) {
      for (const m of t.matchAll(/(\d\.\d)\s?L\b[^;,/]*?\b([A-Z0-9]{2,5}-[A-Z]{2,4}|B[45][68]B\d{2}O\d|FA2[04])\b/g)) {
        const c = cylinders(m[2], "");
        if (c) (cylBySize[m[1]] = cylBySize[m[1]] || new Set()).add(c);
      }
    }
  }
  for (const e of list) if (!e.cyl && cylBySize[e.engine] && cylBySize[e.engine].size === 1) e.cyl = [...cylBySize[e.engine]][0];
  const name = (e) => [e.engine ? `${e.engine}L` : "", e.cyl ? `${e.cyl}-cyl` : "", e.type].filter(Boolean).join(" ");
  const count = {};
  for (const e of list) count[name(e)] = (count[name(e)] || 0) + 1;
  return list
    .map((e) => ({ label: count[name(e)] > 1 && e.code ? `${name(e)} (${e.code})` : name(e), listing: e.listing, engine: e.engine, code: e.code, type: e.type, fuel: /hybrid/i.test(e.type) ? "hybrid" : e.type ? "ev" : "gas" }))
    .sort((a, b) => Number(a.engine || 99) - Number(b.engine || 99) || TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.label.localeCompare(b.label));
}

/* What still has to be asked about a car for its rows to be settled:
   { drive, trans } true when some row hinges on it. */
export function oemAsks(view) {
  if (!view) return { drive: false, trans: false };
  const rows = [...view.fluids, ...view.services];
  return { drive: rows.some((r) => r.open.includes("drive")), trans: rows.some((r) => r.open.includes("trans")) };
}
