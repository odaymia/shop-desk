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
