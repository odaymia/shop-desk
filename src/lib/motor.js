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

async function call(body) {
  try {
    return await cloud.invoke("motor", body);
  } catch {
    // offline / demo / function not deployed — sample so the UI works
    if (body.action === "vehicle") return { vehicle: SAMPLE_VEHICLE, vehicles: [], sample: true };
    if (body.action === "labor") return { labor: SAMPLE_LABOR.filter((l) => !body.q || l.name.toLowerCase().includes(String(body.q).toLowerCase())), sample: true };
    if (body.action === "fluids") return { fluids: SAMPLE_FLUIDS, sample: true };
    if (body.action === "parts") return { parts: [], sample: true };
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
