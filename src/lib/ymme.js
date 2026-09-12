/* Cascading Year → Make → Model → Engine choices for the vehicle form,
   built from the shop's own cars and service specs. No outside database:
   the lists are the vehicles the shop has actually serviced (the imported
   LubeSoft history makes that thousands of cars), and anything not on the
   list is still typed in. Pure — no React, DOM, or storage.

   Each level prefers what's been seen for the exact year, and falls back
   to what's been seen across all years when the exact year has nothing,
   so the engine list is never needlessly empty. */

const norm = (s) => String(s == null ? "" : s).trim();

export function buildYmme(vehicles, specs) {
  const years = new Set();
  const makesByYear = new Map(); // year -> Map(lower -> display)
  const makesAll = new Map(); // "*" -> Map
  const modelsByYM = new Map(); // "year|make" -> Map
  const modelsByMake = new Map(); // "make" -> Map
  const engByYMM = new Map(); // "year|make|model" -> Map
  const engByMM = new Map(); // "make|model" -> Map

  const put = (map, key, val) => {
    const lo = val.toLowerCase();
    let m = map.get(key);
    if (!m) {
      m = new Map();
      map.set(key, m);
    }
    if (!m.has(lo)) m.set(lo, val);
  };
  const eat = (year, make, model, engine) => {
    const mk = norm(make);
    if (!mk) return;
    const mkL = mk.toLowerCase();
    const y = parseInt(year, 10);
    const okY = y >= 1900 && y <= 2100;
    if (okY) {
      years.add(y);
      put(makesByYear, y, mk);
    }
    put(makesAll, "*", mk);
    const md = norm(model);
    if (!md) return;
    const mdL = md.toLowerCase();
    if (okY) put(modelsByYM, y + "|" + mkL, md);
    put(modelsByMake, mkL, md);
    const en = norm(engine);
    if (!en) return;
    if (okY) put(engByYMM, y + "|" + mkL + "|" + mdL, en);
    put(engByMM, mkL + "|" + mdL, en);
  };

  for (const v of Object.values(vehicles || {})) eat(v.year, v.make, v.model, v.engine);
  for (const s of Object.values(specs || {})) eat(s.year, s.make, s.model, s.engine);

  const sortVals = (m) => (m ? [...m.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : []);
  const allMakes = sortVals(makesAll.get("*"));

  return {
    years: [...years].sort((a, b) => b - a),
    allMakes,
    makesFor(y) {
      const exact = sortVals(makesByYear.get(parseInt(y, 10)));
      return exact.length ? exact : allMakes;
    },
    modelsFor(y, make) {
      const mk = norm(make);
      if (!mk) return [];
      const exact = sortVals(modelsByYM.get(parseInt(y, 10) + "|" + mk.toLowerCase()));
      return exact.length ? exact : sortVals(modelsByMake.get(mk.toLowerCase()));
    },
    enginesFor(y, make, model) {
      const mk = norm(make);
      const md = norm(model);
      if (!mk || !md) return [];
      const exact = sortVals(engByYMM.get(parseInt(y, 10) + "|" + mk.toLowerCase() + "|" + md.toLowerCase()));
      return exact.length ? exact : sortVals(engByMM.get(mk.toLowerCase() + "|" + md.toLowerCase()));
    },
  };
}

/* Model years to offer, newest first: next year down to 1981. Older
   classics are typed in. */
export function modelYears(now = new Date().getFullYear()) {
  const out = [];
  for (let y = now + 1; y >= 1981; y--) out.push(String(y));
  return out;
}
