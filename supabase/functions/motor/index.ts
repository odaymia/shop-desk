// Supabase Edge Function: MOTOR DaaS lookups (labor times, fluids, parts),
// kept server-side so the MOTOR keys never reach the browser.
//
// MOTOR's API signs each request: Authorization: Shared <public>:<sig> where
// sig = Base64(HMAC-SHA256(privateKey, "<public>\nGET\n<unixEpoch>\n<uriPath>"))
// plus a Date header within 15 min of MOTOR's clock. The private key is only
// ever used to sign here; it is never sent.
//
// Deploy: Supabase dashboard -> Edge Functions -> Deploy a new function -> name
// it "motor" -> paste this file. Then add the secrets under Edge Functions ->
// Secrets:
//   MOTOR_PUBLIC_KEY, MOTOR_PRIVATE_KEY   (sandbox keys to start; swap for
//   production keys to go live — nothing else changes)
//   MOTOR_BASE_URL   (optional, defaults to https://api.motor.com)
// Until the keys are set the function returns clearly-labeled SAMPLE data so the
// app's flow can be built and demoed.
//
// The caller must be a signed-in shop member (their token is checked).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const PUB = Deno.env.get("MOTOR_PUBLIC_KEY") || "";
const PRIV = Deno.env.get("MOTOR_PRIVATE_KEY") || "";
const BASE = (Deno.env.get("MOTOR_BASE_URL") || "https://api.motor.com").replace(/\/$/, "");
const LIVE = !!(PUB && PRIV);
const enc = (s: string) => new TextEncoder().encode(s);

/* ---- MOTOR request signing ---- */
async function motorGet(path: string): Promise<Record<string, unknown>> {
  const epoch = Math.floor(Date.now() / 1000);
  const uriPath = path.split("?")[0]; // signature excludes the query string
  const key = await crypto.subtle.importKey("raw", enc(PRIV), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc(`${PUB}\nGET\n${epoch}\n${uriPath}`));
  const sig = btoa(String.fromCharCode(...new Uint8Array(mac)));
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Shared ${PUB}:${sig}`, Date: new Date(epoch * 1000).toUTCString(), Accept: "application/json" },
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.Header?.Messages?.[0]?.LongDescription || `MOTOR ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

/* ---- normalizers: MOTOR's verbose JSON -> what the desk needs ---- */
function normVehicle(data: Record<string, unknown>) {
  const list = ((data.Body as Record<string, unknown>)?.Vehicles as Record<string, unknown>[]) || [];
  const vehicles = list.map((v) => ({
    baseVehicleId: v.BaseVehicleID,
    vehicleId: v.VehicleID,
    engineId: v.EngineID,
    year: v.Year,
    make: v.MakeName,
    model: v.ModelName,
    submodel: v.SubModelName,
    engine: v.EngineDescription,
  }));
  return { vehicles, vehicle: vehicles[0] || null };
}
function normLabor(data: Record<string, unknown>, q: string) {
  const apps = ((data.Body as Record<string, unknown>)?.Applications as Record<string, unknown>[]) || [];
  const out: Record<string, unknown>[] = [];
  for (const a of apps) {
    const name = String(a.DisplayName || "");
    if (q && !name.toLowerCase().includes(q.toLowerCase())) continue;
    const item = ((a.Items as Record<string, unknown>[]) || [])[0] || {};
    const notes = ((item.Notes as Record<string, unknown>[]) || []).map((n) => String(n.Text || "")).filter(Boolean);
    out.push({
      name,
      hours: Number(item.BaseLaborTime) || 0,
      warrantyHours: Number(item.BaseWarrantyLaborTime) || 0,
      serviceType: item.ServiceType || "",
      skill: (item.RequiredSkill as Record<string, unknown>)?.Name || "",
      notes,
    });
  }
  out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return out;
}
function normFluids(data: Record<string, unknown>) {
  const apps = ((data.Body as Record<string, unknown>)?.Applications as Record<string, unknown>[]) || [];
  return apps.map((a) => ({
    name: a.DisplayName,
    position: (a.Position as Record<string, unknown>)?.Name || "",
    detail: ((a.Links as Record<string, unknown>[]) || [])[0]?.Href || "",
  }));
}
// The vehicle's factory maintenance schedule: unique service names, each with
// its real interval (smallest positive miles/months across its schedule items).
async function motorMaintenance(V: string) {
  const sum = await motorGet(`${V}/Content/Summaries/Of/MaintenanceSchedules`);
  const apps = ((sum.Body as Record<string, unknown>)?.Applications as Record<string, unknown>[]) || [];
  const seen = new Set<string>();
  const uniq: Record<string, unknown>[] = [];
  for (const a of apps) {
    const n = String(a.DisplayName || "");
    if (!n || seen.has(n)) continue;
    seen.add(n);
    uniq.push(a);
  }
  const capped = uniq.slice(0, 60);
  const details = await Promise.all(
    capped.map((a) => motorGet(`${V}/Content/Details/Of/MaintenanceSchedules/${a.ApplicationID}`).catch(() => null)),
  );
  const services: Record<string, unknown>[] = [];
  for (let i = 0; i < capped.length; i++) {
    const d = details[i];
    if (!d) continue;
    const items = (((d.Body as Record<string, unknown>)?.MaintenanceSchedules as Record<string, unknown>[]) || []).flatMap(
      (m) => (m.Items as Record<string, unknown>[]) || [],
    );
    const mi = items.map((it) => Number(it.IntervalMile) || 0).filter((x) => x > 0);
    const mo = items.map((it) => Number(it.IntervalMonth) || 0).filter((x) => x > 0);
    services.push({ name: capped[i].DisplayName, miles: mi.length ? Math.min(...mi) : 0, months: mo.length ? Math.min(...mo) : 0 });
  }
  return services;
}

function normParts(data: Record<string, unknown>, q: string) {
  const apps = ((data.Body as Record<string, unknown>)?.Applications as Record<string, unknown>[]) || [];
  const out = apps.map((a) => ({
    name: (a.PCDBPart as Record<string, unknown>)?.PartTerminologyName || a.DisplayName,
    position: (a.Position as Record<string, unknown>)?.Name || "",
    qualifiers: ((a.Qualifiers as Record<string, unknown>[]) || []).map((qq) => String(qq.Description || "")).filter(Boolean),
  }));
  return q ? out.filter((p) => String(p.name).toLowerCase().includes(q.toLowerCase())) : out;
}

/* ---- sample data (used until MOTOR keys are set) ---- */
const SAMPLE_LABOR = [
  { name: "Brake Pads Replace — Front", hours: 1.2, warrantyHours: 1.0, serviceType: "Replace", skill: "Standard", notes: ["Includes: R&I front pads, clean and lubricate hardware, road test."] },
  { name: "Brake Pads Replace — Rear", hours: 1.3, warrantyHours: 1.1, serviceType: "Replace", skill: "Standard", notes: [] },
  { name: "Alternator Replace", hours: 1.6, warrantyHours: 1.3, serviceType: "Replace", skill: "Standard", notes: [] },
  { name: "Water Pump Replace", hours: 2.8, warrantyHours: 2.4, serviceType: "Replace", skill: "Standard", notes: ["Includes: drain and refill coolant."] },
  { name: "Serpentine Belt Replace", hours: 0.6, warrantyHours: 0.5, serviceType: "Replace", skill: "Standard", notes: [] },
  { name: "Battery Test", hours: 0.3, warrantyHours: 0.3, serviceType: "Test", skill: "Standard", notes: [] },
  { name: "Brake System Inspect", hours: 0.5, warrantyHours: 0.4, serviceType: "Inspect", skill: "Standard", notes: [] },
];
const SAMPLE_FLUIDS = [
  { name: "Engine Oil Fluid Type", position: "N/A", detail: "" },
  { name: "Differential Fluid Type", position: "Front", detail: "" },
  { name: "Air Conditioning Refrigerant Oil Fluid Type", position: "N/A", detail: "" },
];
const SAMPLE_MAINTENANCE = [
  { name: "Engine Oil & Filter Replace", miles: 7500, months: 12 },
  { name: "Tire Rotation", miles: 7500, months: 12 },
  { name: "Cabin Air Filter Replace", miles: 30000, months: 36 },
  { name: "Engine Air Filter Replace", miles: 30000, months: 36 },
  { name: "Cooling System Fluid Replace", miles: 100000, months: 120 },
  { name: "Automatic Transmission Fluid Replace", miles: 60000, months: 72 },
  { name: "Spark Plug Replace", miles: 100000, months: 120 },
  { name: "Brake System Inspect", miles: 15000, months: 12 },
];

async function shopOf(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return false;
  const { data: member } = await supabase.from("shop_members").select("shop_id").limit(1);
  return !!(member && member.length);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!(await shopOf(req))) return json({ error: "Sign in first" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const action = String(body.action || "");
  const q = String(body.q || "").trim();
  const baseVehicleId = String(body.baseVehicleId || "");

  try {
    if (!LIVE) {
      // sample mode so the flow works before the keys are wired
      if (action === "vehicle") return json({ vehicle: { baseVehicleId: 26332, vehicleId: 76389, engineId: 7929, year: 2012, make: "Ford", model: "F-150", submodel: "FX4", engine: "3.5L V6 (T) Turbocharged GAS FI" }, vehicles: [], sample: true });
      if (action === "labor") return json({ labor: SAMPLE_LABOR.filter((l) => !q || l.name.toLowerCase().includes(q.toLowerCase())), sample: true });
      if (action === "fluids") return json({ fluids: SAMPLE_FLUIDS, sample: true });
      if (action === "parts") return json({ parts: [], sample: true });
      if (action === "maintenance") return json({ services: SAMPLE_MAINTENANCE, sample: true });
      return json({ error: "Unknown action" }, 400);
    }

    if (action === "vehicle") {
      const vin = String(body.vin || "").trim();
      if (vin.length !== 17) return json({ error: "Enter a 17-character VIN" }, 400);
      return json(normVehicle(await motorGet(`/v1/Information/Vehicles/Search/ByVIN?VIN=${encodeURIComponent(vin)}`)));
    }
    if (!baseVehicleId) return json({ error: "Look up the vehicle first" }, 400);
    const V = `/v1/Information/Vehicles/Attributes/BaseVehicleID/${encodeURIComponent(baseVehicleId)}`;
    if (action === "labor") return json({ labor: normLabor(await motorGet(`${V}/Content/Summaries/Of/EstimatedWorkTimes`), q) });
    if (action === "fluids") return json({ fluids: normFluids(await motorGet(`${V}/Content/Summaries/Of/Fluids`)) });
    if (action === "parts") return json({ parts: normParts(await motorGet(`${V}/Content/Summaries/Of/Parts`), q) });
    if (action === "maintenance") return json({ services: await motorMaintenance(V) });
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("motor", action, e);
    return json({ error: (e as Error).message || "MOTOR lookup failed" }, 400);
  }
});
