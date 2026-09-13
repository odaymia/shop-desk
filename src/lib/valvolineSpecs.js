/* Valvoline's published oil grade, capacity, and recommended products by
   vehicle, pulled from their product finder. Loaded on demand (a few MB) so
   it never sits in the startup path. Shape on disk, kept terse to stay small:
     { products: ["<product name>", …],             // shared dictionary
       makes: [{ m: make, mo: [{ n: model,
         e: [{ e: engine, g: grade, q: qt,
               c: [["<system>", [productIndex,…]], …] }] }] }] }
   `c` covers every system Valvoline lists — Engine, Cooling system,
   Transmission, Differential, Power steering, etc. */
let cache = null;
export async function loadValvolineSpecs() {
  if (!cache) cache = (await import("../data/valvolineSpecs.json")).default;
  return cache;
}

const rows = (data) => (data && data.makes) || [];

export const specMakes = (data) => rows(data).map((x) => x.m);
export const specModels = (data, make) => {
  const mk = rows(data).find((x) => x.m === make);
  return mk ? mk.mo.map((m) => m.n) : [];
};
export const specEngines = (data, make, model) => {
  const mk = rows(data).find((x) => x.m === make);
  const md = mk && mk.mo.find((m) => m.n === model);
  return md ? md.e : [];
};

/* The recommended engine oils for one engine row, resolved to names. */
export function enginesProducts(data, engine) {
  const dict = (data && data.products) || [];
  const eng = (engine && engine.c ? engine.c : []).find((c) => c[0] === "Engine");
  return (eng ? eng[1] : []).map((i) => dict[i]).filter(Boolean);
}

/* Every other fluid system Valvoline recommends a product for — coolant,
   gear/diff oil, transmission fluid, power steering, etc. Engine oil is
   returned by enginesProducts and left out here. */
export function engineFluids(data, engine) {
  const dict = (data && data.products) || [];
  return (engine && engine.c ? engine.c : [])
    .filter((c) => c[0] !== "Engine")
    .map((c) => ({ system: c[0], products: c[1].map((i) => dict[i]).filter(Boolean) }))
    .filter((f) => f.products.length);
}

/* Keep the engine oils that are in the car's grade — Valvoline also lists
   off-grade oils that will work, but the counter wants the right weight. */
export function oilsInGrade(products, grade) {
  const g = String(grade || "").trim();
  if (!g) return products;
  const re = new RegExp("(^|[^0-9])" + g.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&") + "([^0-9]|$)", "i");
  const hit = products.filter((n) => re.test(n));
  return hit.length ? hit : products;
}

const norm = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents so "Coupé" matches "Coupe"
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const displacement = (s) => {
  const m = String(s || "").match(/(\d)[.,](\d)/);
  return m ? m[1] + "." + m[2] : "";
};

/* Match a saved vehicle to the Valvoline data so the ticket shows its specs
   without a manual lookup. Forgiving on purpose — imported cars store the
   make/model/engine in all sorts of formats ("TOYOTA", "CAMRY", "2.5L L4"),
   so it matches make/model case- and punctuation-insensitively and the
   engine by displacement (2.5) when the exact name doesn't line up. */
export function findValvolineSpec(data, vehicle) {
  if (!data || !vehicle) return null;
  const mk = rows(data).find((x) => norm(x.m) === norm(vehicle.make));
  if (!mk) return null;
  const vModel = norm(vehicle.model);
  if (!vModel) return null;
  const y = Number(vehicle.year) || 0;
  const vEng = norm(vehicle.engine);
  const vDisp = displacement(vehicle.engine);
  const inYear = (e) => {
    const r = yearRange(e.e);
    return !y || !r || (y >= r[0] && y <= r[1]);
  };
  /* pick the best engine from a set: the car's exact engine, then its
     displacement, then the lone option, then a set that all takes the same oil */
  const pick = (list) => {
    if (!list.length) return null;
    const yh = list.filter(inYear);
    const pool = yh.length ? yh : list;
    let hit =
      (vEng && pool.find((e) => norm(cleanEngineName(e.e)) === vEng)) ||
      (vDisp && pool.find((e) => displacement(e.e) === vDisp)) ||
      (pool.length === 1 && pool[0]) ||
      null;
    if (!hit) {
      const grades = new Set(pool.map((e) => e.g || ""));
      const caps = new Set(pool.map((e) => String(e.q || "")));
      if (grades.size === 1 && caps.size === 1) hit = pool[0];
    }
    return hit || null;
  };

  /* Pass A: the shop's model is Valvoline's model (Toyota Camry, Ford F-150). */
  const a = [];
  for (const md of mk.mo) {
    const cm = norm(cleanModelName(md.n));
    if (cm === vModel || (cm.length >= 3 && vModel.startsWith(cm)) || (vModel.length >= 3 && cm.startsWith(vModel))) {
      for (const e of md.e) a.push(e);
    }
  }
  const hitA = pick(a);
  if (hitA) return specOf(data, hitA);

  /* Pass B: the shop's "model" is really the engine/trim. BMW files a
     "840i Gran Coupe" under model "8 Series Gran Coupé", engine "840i Gran
     Coupé" — so match when the car's model shows up in the engine text. */
  const b = [];
  for (const md of mk.mo) {
    for (const e of md.e) {
      if (!inYear(e)) continue;
      if (norm(e.e).includes(vModel) || (norm(cleanModelName(md.n)) + norm(e.e)).includes(vModel)) b.push(e);
    }
  }
  if (b.length) {
    const grades = new Set(b.map((e) => e.g || ""));
    const caps = new Set(b.map((e) => String(e.q || "")));
    if (grades.size === 1 && caps.size === 1) return specOf(data, b[0]);
    /* the trims disagree on oil — only commit if the car's displacement
       singles one out, otherwise leave it blank rather than guess wrong */
    const dm = vDisp && b.filter((e) => displacement(e.e) === vDisp);
    if (dm && dm.length === 1) return specOf(data, dm[0]);
  }
  return null;
}
function specOf(data, engine) {
  return {
    engine: cleanEngineName(engine.e),
    grade: engine.g || "",
    qt: engine.q || "",
    oils: oilsInGrade(enginesProducts(data, engine), engine.g),
    fluids: engineFluids(data, engine),
  };
}

/* "5.6" -> "5.6 qt", tidy for display */
export const qtText = (q) => (q == null || q === "" ? "" : `${q} qt`);

/* ---- clean lists for the add-a-car dropdowns ---- */
/* Valvoline lists each market separately ("Toyota", "Toyota (EU)"); a US
   shop only wants the plain make. And their model names carry the chassis
   code and years ("Camry, XV50 (2012-2017)") — a vehicle record just wants
   "Camry". */
const EU_VARIANT = /\((?:EU|Classic)\)/i;
export const cleanModelName = (n) =>
  String(n || "")
    .split(",")[0]
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
const yearRange = (n) => {
  const m = String(n || "").match(/\((\d{4})\s*-\s*(\d{4})?\s*\)/);
  return m ? [Number(m[1]), m[2] ? Number(m[2]) : 9999] : null;
};

/* Every make a car could be, minus the foreign-market duplicates. */
export function vvMakeList(data) {
  const seen = new Map();
  for (const x of rows(data)) {
    if (EU_VARIANT.test(x.m)) continue;
    seen.set(x.m.toLowerCase(), x.m);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/* "G90 3.5 T-GDI AWD (2022- )" -> "3.5 T-GDI AWD": drop the year span and
   the leading model token, keep the engine from its displacement on. */
export const cleanEngineName = (n) => {
  const s = String(n || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  const m = s.match(/\d[.,]\d.*/);
  return (m ? m[0] : s).replace(/\s+/g, " ").trim();
};

/* Clean, de-duplicated engine names for a make + model, narrowed to the
   year. Falls back to all years if the exact year has nothing. */
export function vvEngineList(data, make, model, year) {
  const mk = rows(data).find((x) => x.m.toLowerCase() === String(make || "").toLowerCase());
  if (!mk) return [];
  const wantModel = String(model || "").toLowerCase();
  const y = Number(year) || 0;
  const gather = (useYear) => {
    const seen = new Map();
    for (const md of mk.mo) {
      if (cleanModelName(md.n).toLowerCase() !== wantModel) continue;
      for (const e of md.e) {
        const rng = yearRange(e.e);
        if (useYear && y && rng && !(y >= rng[0] && y <= rng[1])) continue;
        const ce = cleanEngineName(e.e);
        if (ce) seen.set(ce.toLowerCase(), ce);
      }
    }
    return seen;
  };
  let seen = gather(true);
  if (!seen.size) seen = gather(false);
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/* Clean, de-duplicated model names for a make, narrowed to the year when
   one is given (each generation carries its own year span). */
export function vvModelList(data, make, year) {
  const mk = rows(data).find((x) => x.m.toLowerCase() === String(make || "").toLowerCase());
  if (!mk) return [];
  const y = Number(year) || 0;
  const seen = new Map();
  for (const md of mk.mo) {
    const rng = yearRange(md.n);
    if (y && rng && !(y >= rng[0] && y <= rng[1])) continue;
    const cm = cleanModelName(md.n);
    if (cm) seen.set(cm.toLowerCase(), cm);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
