/* Per-engine service specs: oil grade and capacity, filter numbers, drain
   plug torque, reset steps. Pure — no React, no storage.

   Specs are keyed by year, make, model and engine. When a car has no
   spec of its own, the nearest year of the same make, model and engine
   is offered, flagged so the counter knows to double-check. The shop
   builds this up one engine at a time; a licensed data feed (MOTOR
   Fluids) can fill the same records automatically later. */

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

export const specKey = (v) => `${Number(v.year) || 0}|${norm(v.make)}|${norm(v.model)}|${norm(v.engine)}`;
export const engineKey = (v) => `${norm(v.make)}|${norm(v.model)}|${norm(v.engine)}`;

export const blankSpec = (v) => ({
  year: Number(v.year) || "",
  make: v.make || "",
  model: v.model || "",
  engine: v.engine || "",
  oilViscosity: "", // 0W-20
  oilSpec: "", // API SP / ILSAC GF-6A / dexos1 Gen3
  oilCapacityQt: "", // with filter
  oilFilters: [], // [{ brand, number }]
  drainPlugTorque: "", // "30 ft-lb"
  resetProcedure: "",
  otherFluids: "",
  notes: "",
  source: "shop",
});

/* Find the spec for a vehicle: exact year first, else the closest year
   with the same make, model and engine. */
export function findSpec(specs, vehicle) {
  if (!vehicle || !vehicle.make) return null;
  const list = Object.values(specs || {});
  const exact = list.find((s) => specKey(s) === specKey(vehicle));
  if (exact) return { spec: exact, exact: true };
  const ek = engineKey(vehicle);
  const y = Number(vehicle.year) || 0;
  const near = list
    .filter((s) => engineKey(s) === ek && s.oilViscosity)
    .sort((a, b) => Math.abs((Number(a.year) || 0) - y) - Math.abs((Number(b.year) || 0) - y))[0];
  return near ? { spec: near, exact: false } : null;
}

export const normalizeViscosity = (s) => {
  const m = String(s || "").toUpperCase().replace(/\s+/g, "").match(/^(\d{1,2})W-?(\d{2})$/);
  return m ? `${m[1]}W-${m[2]}` : String(s || "").toUpperCase().trim();
};

/* Inventory items that are this oil: the viscosity appears in the description. */
export function matchOil(parts, viscosity) {
  const v = normalizeViscosity(viscosity);
  if (!v) return [];
  const re = new RegExp(v.replace("-", "-?"), "i");
  return Object.values(parts || {}).filter((p) => p.active !== false && !p.tire && re.test(String(p.description || "")));
}
export function matchFilter(parts, filters) {
  const nums = new Set((filters || []).map((f) => String(f.number || "").toUpperCase().replace(/[^A-Z0-9]/g, "")));
  return Object.values(parts || {}).filter((p) => p.active !== false && nums.has(String(p.number || "").toUpperCase().replace(/[^A-Z0-9]/g, "")));
}

/* Oil and filter lines for the ticket, from the spec and what's stocked. */
export function oilChangeLines(spec, parts, mkId, cfg) {
  const out = [];
  const qt = Number(spec.oilCapacityQt) || 0;
  const oil = matchOil(parts, spec.oilViscosity)[0];
  const label = `Oil change ${normalizeViscosity(spec.oilViscosity)}`.trim();
  if (qt > 0) {
    out.push({
      id: mkId(),
      kind: "part",
      partId: oil ? oil.id : null,
      number: oil ? oil.number : "",
      description: oil ? oil.description : `${normalizeViscosity(spec.oilViscosity)} motor oil${spec.oilSpec ? ` (${spec.oilSpec})` : ""}`,
      qty: Math.round(qt * 10) / 10,
      price: oil ? Number(oil.price) || 0 : 0,
      cost: oil ? Number(oil.cost) || 0 : 0,
      condition: "new",
      taxable: null,
      job: label,
    });
  }
  const filt = matchFilter(parts, spec.oilFilters)[0];
  const f0 = (spec.oilFilters || [])[0];
  if (filt || f0) {
    out.push({
      id: mkId(),
      kind: "part",
      partId: filt ? filt.id : null,
      number: filt ? filt.number : f0 ? f0.number : "",
      description: filt ? filt.description : `Oil filter${f0 && f0.brand ? ` (${f0.brand})` : ""}`,
      qty: 1,
      price: filt ? Number(filt.price) || 0 : 0,
      cost: filt ? Number(filt.cost) || 0 : 0,
      condition: "new",
      taxable: null,
      job: label,
    });
  }
  const laborPrice = Number(cfg && cfg.oilChangeLaborPrice) || 0;
  if (out.length && laborPrice > 0) {
    out.push({ id: mkId(), kind: "labor", description: "Lube, oil, and filter", details: spec.resetProcedure ? `Reset maintenance light: ${spec.resetProcedure}` : "", hours: 1, rate: laborPrice, unit: "service", taxable: null, job: label });
  }
  return out;
}
