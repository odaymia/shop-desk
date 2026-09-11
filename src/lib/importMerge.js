/* Merging an import bundle into records the shop already has. Pure.

   Cars are matched by VIN, then by plate; people by phone, then by
   email. A match reuses the existing id so history from two systems
   lands on one car and one customer. The result is an id map the import
   applies to every record it writes. */

const digits = (s) => String(s || "").replace(/\D/g, "").slice(-10);
const plateKey = (s) => String(s || "").toUpperCase().replace(/^[A-Z]{2}-/, "").replace(/[^A-Z0-9]/g, "");
const vinKey = (s) => {
  const v = String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return v.length === 17 ? v : "";
};
const isPlaceholderName = (c) => !/[A-Za-z0-9]/.test(`${c.first || ""}${c.last || ""}${c.company || ""}`);

export function planMerge(bundle, existing) {
  const byVin = new Map();
  const byPlate = new Map();
  for (const v of Object.values(existing.vehicles || {})) {
    if (v.active === false) continue;
    const k = vinKey(v.vin);
    if (k && !byVin.has(k)) byVin.set(k, v);
    const p = plateKey(v.plate);
    if (p && !byPlate.has(p)) byPlate.set(p, v);
  }
  const byPhone = new Map();
  const byEmail = new Map();
  for (const c of Object.values(existing.customers || {})) {
    if (c.active === false) continue;
    for (const ph of [c.phone, c.phone2]) {
      const d = digits(ph);
      if (d.length === 10 && !byPhone.has(d)) byPhone.set(d, c);
    }
    const e = String(c.email || "").trim().toLowerCase();
    if (e && !byEmail.has(e)) byEmail.set(e, c);
  }

  const customerMap = {}; // bundle id -> existing id
  const customerNotes = [];
  for (const c of bundle.customers || []) {
    let hit = null;
    for (const ph of [c.phone, c.phone2]) {
      const d = digits(ph);
      if (d.length === 10 && byPhone.has(d)) hit = byPhone.get(d);
    }
    if (!hit) {
      const e = String(c.email || "").trim().toLowerCase();
      if (e && byEmail.has(e)) hit = byEmail.get(e);
    }
    if (hit) customerMap[c.id] = hit.id;
  }

  const vehicleMap = {}; // bundle id -> existing id
  const vehicleOwner = {}; // bundle vehicle id -> existing customer id to keep
  for (const v of bundle.vehicles || []) {
    const hit = byVin.get(vinKey(v.vin)) || byPlate.get(plateKey(v.plate));
    if (!hit) continue;
    vehicleMap[v.id] = hit.id;
    if (hit.customerId) vehicleOwner[v.id] = hit.customerId;
  }

  /* a bundle customer with no real name (a walk-in keyed to a car) that
     only owns matched cars is dropped in favor of the existing owner */
  const dropCustomers = new Set();
  const ownedBy = {};
  for (const v of bundle.vehicles || []) if (v.customerId) (ownedBy[v.customerId] ||= []).push(v);
  for (const c of bundle.customers || []) {
    if (customerMap[c.id]) continue;
    const cars = ownedBy[c.id] || [];
    if (isPlaceholderName(c) && cars.length && cars.every((v) => vehicleOwner[v.id])) {
      dropCustomers.add(c.id);
      customerNotes.push({ bundleId: c.id, reason: "placeholder, cars already owned" });
    }
  }

  return {
    customerMap,
    vehicleMap,
    vehicleOwner,
    dropCustomers,
    counts: {
      customersMatched: Object.keys(customerMap).length,
      vehiclesMatched: Object.keys(vehicleMap).length,
      customersDropped: dropCustomers.size,
    },
  };
}

/* Apply the plan to one record on its way in. */
export function remap(kind, rec, plan) {
  const r = { ...rec };
  if (kind === "vehicles") {
    if (plan.vehicleMap[r.id]) r.id = plan.vehicleMap[rec.id];
    if (plan.vehicleOwner[rec.id]) r.customerId = plan.vehicleOwner[rec.id];
    else if (r.customerId && plan.customerMap[r.customerId]) r.customerId = plan.customerMap[r.customerId];
    else if (r.customerId && plan.dropCustomers.has(r.customerId)) r.customerId = null;
  } else if (kind === "orders") {
    if (r.vehicleId && plan.vehicleMap[r.vehicleId]) r.vehicleId = plan.vehicleMap[r.vehicleId];
    if (r.customerId && plan.customerMap[r.customerId]) r.customerId = plan.customerMap[r.customerId];
    else if (r.vehicleId && plan.vehicleOwner[rec.vehicleId]) r.customerId = plan.vehicleOwner[rec.vehicleId];
    else if (r.customerId && plan.dropCustomers.has(r.customerId)) r.customerId = null;
  } else if (kind === "customers") {
    if (plan.customerMap[r.id]) r.id = plan.customerMap[rec.id];
  }
  return r;
}

/* When a bundle customer maps onto an existing one, keep the existing
   record and fill only its blanks from the bundle. */
export function mergeCustomer(existing, incoming) {
  const out = { ...existing };
  for (const k of ["first", "last", "company", "phone", "phone2", "email", "street", "city", "state", "zip", "notes"]) {
    if (!String(out[k] || "").trim() && String(incoming[k] || "").trim()) out[k] = incoming[k];
  }
  return out;
}
export function mergeVehicle(existing, incoming) {
  const out = { ...existing };
  for (const k of ["vin", "plate", "plateState", "year", "make", "model", "submodel", "engine", "color", "notes"]) {
    if (!String(out[k] || "").trim() && String(incoming[k] || "").trim()) out[k] = incoming[k];
  }
  if (Number(incoming.mileage) > Number(out.mileage || 0)) out.mileage = incoming.mileage;
  return out;
}
