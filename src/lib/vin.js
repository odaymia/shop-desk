/* VIN decode through NHTSA's free vPIC service. No key, no account.
   Returns year/make/model/engine or null when the VIN can't be read. */

const clean = (v) => String(v || "").toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");

export function isVin(v) {
  return clean(v).length === 17;
}

export async function decodeVin(vin) {
  const v = clean(vin);
  if (v.length !== 17) return null;
  const r = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${v}?format=json`);
  if (!r.ok) throw new Error("VIN service didn't answer");
  const j = await r.json();
  const d = j && j.Results && j.Results[0];
  if (!d || !d.Make) return null;
  const engineBits = [
    d.DisplacementL ? `${Number(d.DisplacementL).toFixed(1)}L` : "",
    d.EngineCylinders ? `${d.EngineCylinders}-cyl` : "",
    d.FuelTypePrimary && /electric/i.test(d.FuelTypePrimary) ? "Electric" : "",
    d.Turbo && /yes/i.test(d.Turbo) ? "Turbo" : "",
  ].filter(Boolean);
  return {
    vin: v,
    year: d.ModelYear ? Number(d.ModelYear) : null,
    make: titleCase(d.Make),
    model: d.Model || "",
    submodel: d.Trim || d.Series || "",
    engine: engineBits.join(" "),
    body: d.BodyClass || "",
    drive: d.DriveType || "",
  };
}

function titleCase(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bBmw\b/, "BMW")
    .replace(/\bGmc\b/, "GMC")
    .replace(/\bRam\b/, "RAM")
    .replace(/\bMini\b/, "MINI");
}
