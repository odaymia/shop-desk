// Supabase Edge Function: the customer portal's question helper.
//
// Deploy from the Supabase dashboard (Edge Functions → Deploy a new
// function → name it portal-chat → paste this file) and add the secret
// ANTHROPIC_API_KEY under Edge Functions → Secrets. The portal calls it
// with the customer's sign-in token; the function reads only that
// customer's own record and the shop's public card, and answers questions
// about services and what they're for. It never sees other customers.
import Anthropic from "npm:@anthropic-ai/sdk@0.60.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Sign in first" }, 401);

  // A client that acts as the signed-in customer, so row-level security applies.
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user?.email) return json({ error: "Sign in first" }, 401);
  const email = userData.user.email.toLowerCase();

  let body: { question?: string; history?: { role: "user" | "assistant"; content: string }[]; vehicleId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const question = String(body.question || "").trim().slice(0, 2000);
  if (!question) return json({ error: "Ask something" }, 400);
  const history = (body.history || []).slice(-10).map((m) => ({ role: m.role, content: String(m.content || "").slice(0, 4000) }));

  const { data: rows } = await supabase.from("customer_portal").select("shop_id, data").ilike("email", email);
  const row = rows?.[0];
  const { data: shops } = row ? await supabase.from("shop_public").select("data").eq("shop_id", row.shop_id) : { data: [] };
  const shop = shops?.[0]?.data || {};
  const cust = row?.data || {};
  const vehicle = (cust.vehicles || []).find((v: { id: string }) => v.id === body.vehicleId) || (cust.vehicles || [])[0];

  const fmtDate = (ts?: number) => (ts ? new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
  const carContext = vehicle
    ? [
        `Vehicle: ${vehicle.name}${vehicle.mileage ? `, about ${Number(vehicle.mileage).toLocaleString()} miles` : ""}.`,
        vehicle.oil ? `Oil spec on file: ${vehicle.oil.grade}, ${vehicle.oil.quarts} quarts.` : "",
        vehicle.oilQuote ? `The shop's oil change price for this car: $${Number(vehicle.oilQuote.total).toFixed(2)} out the door.` : "",
        vehicle.due?.length
          ? "Coming up: " + vehicle.due.map((d: { label: string; status: string; dueDate?: number; dueMiles?: number }) => `${d.label} (${d.status === "overdue" ? "due now" : d.status === "soon" ? "due soon" : "due"}${d.dueDate ? ` around ${fmtDate(d.dueDate)}` : ""}${d.dueMiles ? ` or ${Number(d.dueMiles).toLocaleString()} mi` : ""})`).join("; ") + "."
          : "No services are on the schedule yet.",
        vehicle.history?.length
          ? "Recent visits: " + vehicle.history.slice(0, 8).map((h: { date?: number; miles?: number; work: { text: string }[] }) => `${fmtDate(h.date)}${h.miles ? ` at ${Number(h.miles).toLocaleString()} mi` : ""}: ${h.work.map((w) => w.text).join(", ")}`).join(" | ") + "."
          : "No visits on record here.",
      ].filter(Boolean).join("\n")
    : "No vehicle on file for this customer.";
  const menu = (shop.menu || []).map((m: { name: string; price: number; per?: string; details?: string }) => `- ${m.name}: $${Number(m.price).toFixed(2)}${m.per ? ` per ${m.per}` : ""}${m.details ? ` — ${m.details}` : ""}`).join("\n");

  const system = `You are the service helper for ${shop.name || "the shop"}, an independent auto repair shop${shop.address ? ` at ${shop.address}` : ""}${shop.phone ? `, phone ${shop.phone}` : ""}${shop.hours ? `, hours ${shop.hours}` : ""}. You're talking with one of the shop's customers${cust.name ? `, ${cust.name}` : ""}, in the shop's customer portal.

What you help with: explaining what a service is and why it matters for their car, what "due" means, what's typical for their mileage, how to read their history, and what the shop's listed prices cover. Be a straight-talking, friendly service advisor: plain words, short answers, no hype.

Rules:
- Only quote prices that appear in the price menu or the oil change quote below. For anything else, say the shop will quote it and suggest calling${shop.phone ? ` ${shop.phone}` : ""}.
- Don't diagnose a specific problem from a description. Say what it could be in general terms and that a technician needs to look at it.
- Don't promise appointment times, warranties, or discounts. The shop handles those.
- If asked about something unrelated to their car or the shop, say that's outside what you can help with here.
- Keep answers under about 120 words unless they ask for detail.

The customer's car:
${carContext}

The shop's listed prices${menu ? ":\n" + menu : ": none listed. Plus sales tax on parts."}`;

  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
  try {
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 2000,
      output_config: { effort: "low" },
      system,
      messages: [...history, { role: "user", content: question }],
    });
    if (response.stop_reason === "refusal") return json({ answer: "I can't help with that one here. The shop can, though — give them a call." });
    const answer = response.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n").trim();
    return json({ answer: answer || "I didn't catch that. Could you ask another way?" });
  } catch (e) {
    console.error(e);
    return json({ error: "The helper is unavailable right now. Please call the shop." }, 502);
  }
});
