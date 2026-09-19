/* Address autocomplete, backed by Photon — a free, key-less geocoder over
   OpenStreetMap data (https://photon.komoot.io). We send the partial address
   the person is typing and get back structured suggestions to fill the street,
   city, state, and ZIP. No account, no API key, no cost.

   parseFeature is pure and tested; searchAddresses does the fetch. If we ever
   want sharper US results, this is the one spot to swap in Google/Smarty. */

const PHOTON = "https://photon.komoot.io/api/";

/* OSM returns the full state name; the customer record stores the 2-letter
   postal code, so map it back. */
const STATE_ABBR = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};

const stateAbbr = (name) => {
  const s = String(name || "").trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return STATE_ABBR[s.toLowerCase()] || "";
};

/* Turn one Photon GeoJSON feature into the fields our form uses. */
export function parseFeature(f) {
  const p = (f && f.properties) || {};
  const street = [p.housenumber, p.street || p.name].filter(Boolean).join(" ").trim();
  const city = p.city || p.town || p.village || p.municipality || p.county || "";
  const state = stateAbbr(p.state);
  const zip = String(p.postcode || "").trim();
  const country = String(p.countrycode || "").toUpperCase();
  const label = [street, city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return { street, city, state, zip, country, label };
}

/* Suggestions for a partial address. Returns US street addresses, de-duped,
   best first. Throws on a network error (callers ignore an aborted request). */
export async function searchAddresses(query, opts = {}) {
  const q = String(query || "").trim();
  if (q.length < 3) return [];
  const params = new URLSearchParams({ q, limit: "8", lang: "en" });
  if (opts.near && opts.near.lat != null && opts.near.lon != null) {
    params.set("lat", String(opts.near.lat));
    params.set("lon", String(opts.near.lon));
  }
  const res = await fetch(`${PHOTON}?${params.toString()}`, { signal: opts.signal });
  if (!res.ok) throw new Error(`address lookup failed (${res.status})`);
  const data = await res.json();
  const seen = new Set();
  const out = [];
  for (const f of (data && data.features) || []) {
    const a = parseFeature(f);
    if (a.country && a.country !== "US") continue; // this shop's customers are US
    if (!a.street) continue; // skip city/region-only hits — we want a street
    if (seen.has(a.label)) continue;
    seen.add(a.label);
    out.push(a);
    if (out.length >= 6) break;
  }
  return out;
}
