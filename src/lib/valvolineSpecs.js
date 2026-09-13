/* Valvoline's published oil grade + capacity by vehicle, pulled from their
   product finder. Loaded on demand (a couple of MB) so it never sits in the
   startup path. Shape on disk, kept terse to stay small:
     [{ m: make, mo: [{ n: model, e: [{ e: engine, g: grade, q: qt }] }] }] */
let cache = null;
export async function loadValvolineSpecs() {
  if (!cache) cache = (await import("../data/valvolineSpecs.json")).default;
  return cache;
}

export const specMakes = (data) => (data || []).map((x) => x.m);
export const specModels = (data, make) => {
  const mk = (data || []).find((x) => x.m === make);
  return mk ? mk.mo.map((m) => m.n) : [];
};
export const specEngines = (data, make, model) => {
  const mk = (data || []).find((x) => x.m === make);
  const md = mk && mk.mo.find((m) => m.n === model);
  return md ? md.e : [];
};

/* "5.6" -> "5.6 quarts", tidy for display */
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
  for (const x of data || []) {
    if (EU_VARIANT.test(x.m)) continue;
    seen.set(x.m.toLowerCase(), x.m);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/* Clean, de-duplicated model names for a make, narrowed to the year when
   one is given (each generation carries its own year span). */
export function vvModelList(data, make, year) {
  const mk = (data || []).find((x) => x.m.toLowerCase() === String(make || "").toLowerCase());
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
