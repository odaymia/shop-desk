// Supabase Edge Function: live tire lookup from the shop's distributor
// (US AutoForce), kept server-side so the wholesale credentials never reach
// the browser.
//
// Deploy: Supabase dashboard → Edge Functions → Deploy a new function →
// name it "tire-search" → paste this file. Then add the secrets under Edge
// Functions → Secrets:
//   USAF_API_KEY, USAF_PASSWORD, USAF_ACCOUNT, USAF_BASE_URL   (from your
//   US AutoForce rep). Until those are set the function returns clearly
//   labeled SAMPLE data so the app's flow can be built and demoed.
//
// The caller must be a signed-in shop member (their token is checked); the
// function reads no shop data, it only brokers the distributor call.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Tire = {
  sku: string;
  brand: string;
  model: string;
  size: string;
  loadSpeed?: string;
  cost: number; // your dealer cost
  map?: number; // minimum advertised price, when the distributor sends it
  stock: { warehouse: string; qty: number }[];
};

/* ---- US AutoForce adapter --------------------------------------------
   FILL IN with the real endpoint + auth once US AutoForce sends the API
   docs and credentials. Their API returns dealer cost, MAP, and per-
   warehouse availability. Normalize whatever it returns into Tire[]. */
async function searchUsAutoForce(size: string): Promise<Tire[]> {
  const base = Deno.env.get("USAF_BASE_URL");
  const key = Deno.env.get("USAF_API_KEY");
  const password = Deno.env.get("USAF_PASSWORD");
  const account = Deno.env.get("USAF_ACCOUNT");
  if (!base || !key || !password) throw new Error("USAF credentials not set");

  // TODO: replace with the real request shape from US AutoForce's API docs.
  const res = await fetch(`${base.replace(/\/$/, "")}/tires/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${btoa(`${key}:${password}`)}`,
      ...(account ? { "X-Account": account } : {}),
    },
    body: JSON.stringify({ size }),
  });
  if (!res.ok) throw new Error(`USAF ${res.status}`);
  const raw = await res.json();
  // TODO: map raw -> Tire[] per the real payload. Placeholder mapping:
  const items = raw.items ?? raw.results ?? [];
  return items.map((it: Record<string, unknown>) => ({
    sku: String(it.sku ?? it.itemNumber ?? ""),
    brand: String(it.brand ?? ""),
    model: String(it.model ?? it.description ?? ""),
    size: String(it.size ?? size),
    loadSpeed: it.loadSpeed ? String(it.loadSpeed) : undefined,
    cost: Number(it.cost ?? it.dealerPrice ?? 0),
    map: it.map != null ? Number(it.map) : undefined,
    stock: Array.isArray(it.availability)
      ? (it.availability as Record<string, unknown>[]).map((a) => ({ warehouse: String(a.warehouse ?? a.location ?? ""), qty: Number(a.qty ?? a.quantity ?? 0) }))
      : [],
  }));
}

/* Sample results so the UI works before the real account is wired up. */
function sampleTires(size: string): Tire[] {
  const s = size || "225/65R17";
  return [
    { sku: "SAMPLE-1", brand: "Michelin", model: "Defender T+H", size: s, loadSpeed: "102H", cost: 118.4, map: 179.99, stock: [{ warehouse: "Ontario, CA", qty: 24 }, { warehouse: "Fontana, CA", qty: 8 }] },
    { sku: "SAMPLE-2", brand: "Goodyear", model: "Assurance MaxLife", size: s, loadSpeed: "104T", cost: 104.1, map: 164.99, stock: [{ warehouse: "Ontario, CA", qty: 12 }] },
    { sku: "SAMPLE-3", brand: "Bridgestone", model: "Turanza QuietTrack", size: s, loadSpeed: "102H", cost: 132.75, map: 199.99, stock: [{ warehouse: "Fontana, CA", qty: 4 }] },
    { sku: "SAMPLE-4", brand: "Continental", model: "TrueContact Tour", size: s, loadSpeed: "102H", cost: 96.2, map: 154.99, stock: [{ warehouse: "Ontario, CA", qty: 0 }, { warehouse: "Las Vegas, NV", qty: 16 }] },
    { sku: "SAMPLE-5", brand: "Cooper", model: "Endeavor", size: s, loadSpeed: "104H", cost: 88.5, map: 139.99, stock: [{ warehouse: "Ontario, CA", qty: 30 }] },
  ];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Sign in first" }, 401);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return json({ error: "Sign in first" }, 401);
  // must belong to a shop (RLS lets them read only their own membership)
  const { data: member } = await supabase.from("shop_members").select("shop_id").limit(1);
  if (!member || !member.length) return json({ error: "No shop linked" }, 403);

  let body: { size?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const size = String(body.size || "").trim().slice(0, 32);
  if (!size) return json({ error: "Enter a tire size" }, 400);

  const configured = !!(Deno.env.get("USAF_API_KEY") && Deno.env.get("USAF_PASSWORD") && Deno.env.get("USAF_BASE_URL"));
  if (!configured) return json({ tires: sampleTires(size), sample: true, distributor: "US AutoForce" });
  try {
    const tires = await searchUsAutoForce(size);
    return json({ tires, sample: false, distributor: "US AutoForce" });
  } catch (e) {
    console.error("USAF search failed", e);
    return json({ tires: sampleTires(size), sample: true, distributor: "US AutoForce", error: "Distributor unavailable — showing sample results." });
  }
});
