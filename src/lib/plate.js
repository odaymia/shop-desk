/* License plate → VIN through PlateToVIN (platetovin.com). DMV records
   aren't public, so this goes through a licensed provider that charges
   a few cents a lookup and needs the shop's own API key, entered under
   Settings. The provider allows calls straight from the browser, so no
   server sits in between. A repeat lookup of the same plate within a
   week isn't charged again. */

const ENDPOINT = "https://platetovin.com/api/convert";
export const PLATE_PROVIDER = { name: "PlateToVIN", signup: "https://platetovin.com/register", costText: "5¢ per lookup" };

const cleanPlate = (p) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/* Pure: turn the provider's JSON into { vin, year, make, model, submodel,
   engine, color } or throw a message a service writer can read. Handles
   both response shapes the provider has documented: `vin` as an object
   with a quick decode, or the bare VIN in `message`. */
export function parsePlateResult(json) {
  if (!json || typeof json !== "object") throw new Error("The plate service sent back something unreadable.");
  if (!json.success) {
    const m = String(json.message || "");
    if (/no result/i.test(m)) throw new Error("No vehicle on file for that plate and state. Check the plate, or enter the VIN instead.");
    if (/credit/i.test(m)) throw new Error("The plate lookup account is out of credit. Top it up at platetovin.com.");
    if (/api key/i.test(m)) throw new Error("The plate lookup key in Settings isn't valid.");
    throw new Error(m || "Plate lookup failed.");
  }
  const v = json.vin && typeof json.vin === "object" ? json.vin : null;
  const vin = String((v && v.vin) || json.message || "").toUpperCase().trim();
  if (vin.length !== 17) throw new Error("The plate service didn't return a full VIN.");
  return {
    vin,
    year: v && v.year ? Number(v.year) : null,
    make: (v && v.make) || "",
    model: (v && v.model) || "",
    submodel: (v && v.trim) || "",
    engine: (v && v.engine) || "",
    color: (v && v.color && (v.color.name || v.color)) || "",
  };
}

export async function lookupPlate(plate, state, apiKey) {
  const p = cleanPlate(plate);
  if (!apiKey) throw new Error("Add a plate lookup key under Settings first.");
  if (p.length < 2) throw new Error("Enter the plate first.");
  if (!state) throw new Error("Pick the plate's state.");
  let r;
  try {
    r = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ plate: p, state }),
    });
  } catch {
    throw new Error("No connection to the plate service right now.");
  }
  let json = null;
  try {
    json = await r.json();
  } catch {
    /* fall through to the parser's message */
  }
  return parsePlateResult(json);
}
