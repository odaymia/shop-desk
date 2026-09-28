/* MOTOR labor guide, fluids, and parts — through the "motor" Edge Function,
   which holds the MOTOR keys and signs each request. The browser never sees the
   keys. Falls back to clearly-labeled SAMPLE data when there's no cloud (demo)
   or the function isn't set up yet, so the flow always works.

   Flow: look up the vehicle by VIN once (→ baseVehicleId), then pull labor
   times / fluids / parts for that vehicle. */
import { cloud } from "../storage/index.js";

const SAMPLE_LABOR = [
  { name: "Brake Pads Replace — Front", hours: 1.2, warrantyHours: 1.0, serviceType: "Replace", skill: "Standard", notes: ["Includes: R&I front pads, clean & lubricate hardware, road test."] },
  { name: "Brake Pads Replace — Rear", hours: 1.3, warrantyHours: 1.1, serviceType: "Replace", skill: "Standard", notes: [] },
  { name: "Alternator Replace", hours: 1.6, warrantyHours: 1.3, serviceType: "Replace", skill: "Standard", notes: [] },
  { name: "Water Pump Replace", hours: 2.8, warrantyHours: 2.4, serviceType: "Replace", skill: "Standard", notes: ["Includes: drain & refill coolant."] },
  { name: "Serpentine Belt Replace", hours: 0.6, warrantyHours: 0.5, serviceType: "Replace", skill: "Standard", notes: [] },
  { name: "Battery Test", hours: 0.3, warrantyHours: 0.3, serviceType: "Test", skill: "Standard", notes: [] },
  { name: "Brake System Inspect", hours: 0.5, warrantyHours: 0.4, serviceType: "Inspect", skill: "Standard", notes: [] },
];
const SAMPLE_FLUIDS = [
  { name: "Engine Oil Fluid Type", position: "N/A", detail: "" },
  { name: "Differential Fluid Type", position: "Front", detail: "" },
  { name: "Air Conditioning Refrigerant Oil Fluid Type", position: "N/A", detail: "" },
];
const SAMPLE_VEHICLE = { baseVehicleId: 26332, vehicleId: 76389, engineId: 7929, year: 2012, make: "Ford", model: "F-150", submodel: "FX4", engine: "3.5L V6 (T) Turbocharged GAS FI" };
const SAMPLE_MAINTENANCE = [
  { name: "Engine Oil & Filter Replace", miles: 7500, months: 12 },
  { name: "Tire Rotation", miles: 7500, months: 12 },
  { name: "Cabin Air Filter Replace", miles: 30000, months: 36 },
  { name: "Engine Air Filter Replace", miles: 30000, months: 36 },
  { name: "Cooling System Fluid Replace", miles: 100000, months: 120 },
  { name: "Automatic Transmission Fluid Replace", miles: 60000, months: 72 },
  { name: "Spark Plug Replace", miles: 100000, months: 120 },
];
const SAMPLE_CONTENT = {
  Fluids: ["Engine Oil", "Engine Coolant", "Brake Fluid", "Automatic Transmission Fluid", "Differential Fluid"],
  Specifications: ["Engine Oil Capacity", "Cooling System Capacity", "Spark Plug Gap", "Lug Nut Torque", "Wheel Alignment — Toe"],
  Parts: ["Oil Filter", "Engine Air Filter", "Cabin Air Filter", "Front Brake Pads", "Spark Plug"],
  EstimatedWorkTimes: ["Brake Pads Replace — Front", "Alternator Replace", "Water Pump Replace"],
  MaintenanceSchedules: ["Engine Oil & Filter Replace", "Tire Rotation", "Cabin Air Filter Replace"],
  ServiceProcedures: ["ABS Control Module R&R", "Alternator R&R", "Water Pump R&R"],
  TechnicalServiceBulletins: ["Aluminum Panel Corrosion", "Transmission Shudder — Reprogram", "Water Pump Weep Hole Seepage"],
  DiagnosticTroubleCodes: ["P0300 — Random/Multiple Cylinder Misfire", "P0171 — System Too Lean (Bank 1)", "P0420 — Catalyst Efficiency Below Threshold"],
  ComponentLocations: ["Body Wiring Harness", "PCM Location", "Fuse Box"],
  WiringDiagrams: ["Charging System", "Starting System", "Power Distribution"],
};

/* a made-up but realistic answer, numbers matching the demo shop's shelf */
const SAMPLE_FILTERS = {
  engines: [{ id: "3476", description: "3.5L V6 (J35Z2) GAS FI", liters: "3.5", cylinders: "6", code: "J35Z2" }],
  parts: [
    { type: "oil", engineId: "3476", position: "", label: "", numbers: ["VO-106"] },
    { type: "air", engineId: "3476", position: "", label: "", numbers: ["CA10467"] },
    { type: "cabin", engineId: "3476", position: "", label: "", numbers: ["CF10285"] },
    { type: "wiper", engineId: "3476", position: "Front Left", label: "Beam Blade", numbers: ["VB-26"], items: [{ number: "VB-26", notes: ["22 in.", "Arm Connector: Hook 9x3"] }] },
    { type: "wiper", engineId: "3476", position: "Front Right", label: "Beam Blade", numbers: ["VB-19"], items: [{ number: "VB-19", notes: ["19 in.", "Arm Connector: Hook 9x3"] }] },
  ],
};

async function call(body) {
  try {
    return await cloud.invoke("motor", body);
  } catch {
    // offline / demo / function not deployed — sample so the UI works
    if (body.action === "vehicle") return { vehicle: SAMPLE_VEHICLE, vehicles: [], sample: true };
    if (body.action === "labor") return { labor: SAMPLE_LABOR.filter((l) => !body.q || l.name.toLowerCase().includes(String(body.q).toLowerCase())), sample: true };
    if (body.action === "fluids") return { fluids: SAMPLE_FLUIDS, sample: true };
    if (body.action === "parts") return { parts: [], sample: true };
    if (body.action === "maintenance") return { services: SAMPLE_MAINTENANCE, sample: true };
    if (body.action === "filters") return { ...SAMPLE_FILTERS, sample: true };
    if (body.action === "ymme") {
      if (body.level === "years") return { years: ["2012", "2011", "2010"], sample: true };
      if (body.level === "makes") return { makes: [{ id: "74", name: "Toyota" }], sample: true };
      if (body.level === "models") return { models: [{ id: "940", name: "Camry" }], sample: true };
      return { baseVehicleId: "20957", engines: [{ id: "0", name: "2.5L L4 (sample)" }], sample: true };
    }
    if (body.action === "content") return { items: (SAMPLE_CONTENT[body.type] || []).map((name) => ({ name, id: 0 })), sample: true };
    if (body.action === "content-detail") return { detail: { Note: "Sample — connect MOTOR to see the full detail for this item." }, sample: true };
    return { sample: true };
  }
}

/* Decode a VIN to a MOTOR vehicle. Returns { vehicle, vehicles, sample }. */
export const motorVehicle = (vin) => call({ action: "vehicle", vin });

/* Labor times for a vehicle, optionally filtered by a keyword. Returns
   { labor: [{ name, hours, warrantyHours, serviceType, skill, notes }], sample }. */
export const motorLabor = (baseVehicleId, q) => call({ action: "labor", baseVehicleId, q });

/* Fluid specs for a vehicle. Returns { fluids: [{ name, position, detail }], sample }. */
export const motorFluids = (baseVehicleId) => call({ action: "fluids", baseVehicleId });

/* Parts (incl. filters, with full production data) for a vehicle, optionally
   filtered by a keyword. Returns { parts: [{ name, position, qualifiers }], sample }. */
export const motorParts = (baseVehicleId, q) => call({ action: "parts", baseVehicleId, q });

/* The vehicle's factory maintenance schedule. Returns
   { services: [{ name, miles, months }], sample } — the real OEM intervals. */
export const motorMaintenance = (baseVehicleId) => call({ action: "maintenance", baseVehicleId });

/* Browse any MOTOR content domain for a vehicle (Fluids, Specifications, Parts,
   ServiceProcedures, TechnicalServiceBulletins, DiagnosticTroubleCodes,
   ComponentLocations, WiringDiagrams, …). Returns { items: [{ name, id }], sample }. */
export const motorContent = (baseVehicleId, type) => call({ action: "content", baseVehicleId, type });

/* The detail for one content item. Returns { detail, sample } — the raw MOTOR
   record (engine/submodel block stripped), rendered generically by the panel. */
export const motorContentDetail = (baseVehicleId, type, id) => call({ action: "content-detail", baseVehicleId, type, id });

/* Filters and wiper blades for a vehicle from the Valvoline aftermarket
   catalog, per engine. Returns { engines, parts: [{ type: oil|air|cabin|
   fuel|wiper, engineId, position, label, numbers }], sample }. */
export const motorFilters = (baseVehicleId) => call({ action: "filters", baseVehicleId });

/* Year → Make → Model → Engine, for linking a car to MOTOR without a VIN.
   level "years" → { years }, "makes" (year) → { makes: [{ id, name }] },
   "models" (year, makeId) → { models }, "vehicle" (year, makeId, modelId)
   → { baseVehicleId, engines: [{ id, name }] }. */
const ymmeCache = new Map(); // real answers only, for this session
export async function motorYmme(level, args = {}) {
  const key = JSON.stringify([level, args.year || "", args.makeId || "", args.modelId || ""]);
  if (ymmeCache.has(key)) return ymmeCache.get(key);
  const r = await call({ action: "ymme", level, ...args });
  if (r && !r.sample && !r.error) ymmeCache.set(key, r);
  return r;
}

/* The MOTOR vehicle for a car on file: the link saved on the car (from
   the Year/Make/Model picker or an earlier VIN decode) wins; otherwise
   decode its VIN. → { vehicle: { baseVehicleId, engineId, ... } | null,
   sample, error }. */
export async function motorVehicleFor(car) {
  const link = car && car.motor;
  if (link && link.baseVehicleId) return { vehicle: { ...link }, sample: !!link.sample };
  const vin = String((car && car.vin) || "").trim();
  if (vin.length !== 17) return { vehicle: null, error: "Link this car to MOTOR (the MOTOR button on the vehicle) or add its 17-character VIN." };
  const r = await motorVehicle(vin);
  if (r && !r.vehicle) return { ...r, error: r.error || "MOTOR didn't find that VIN. Link the car by year, make and model instead." };
  return r;
}
