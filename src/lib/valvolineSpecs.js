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
