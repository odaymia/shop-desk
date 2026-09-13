/* Talking to the shop's tire distributor (US AutoForce) through the
   tire-search Edge Function, which holds the wholesale credentials. The
   browser never sees them. Falls back to sample data when there's no cloud
   (demo) or the function isn't set up yet, so the flow always works. */
import { cloud } from "../storage/index.js";
import { sellPrice, round2 } from "./parts.js";

function sampleTires(size) {
  const s = size || "225/65R17";
  return [
    { sku: "SAMPLE-1", brand: "Michelin", model: "Defender T+H", size: s, loadSpeed: "102H", cost: 118.4, map: 179.99, stock: [{ warehouse: "Ontario, CA", qty: 24 }, { warehouse: "Fontana, CA", qty: 8 }] },
    { sku: "SAMPLE-2", brand: "Goodyear", model: "Assurance MaxLife", size: s, loadSpeed: "104T", cost: 104.1, map: 164.99, stock: [{ warehouse: "Ontario, CA", qty: 12 }] },
    { sku: "SAMPLE-3", brand: "Bridgestone", model: "Turanza QuietTrack", size: s, loadSpeed: "102H", cost: 132.75, map: 199.99, stock: [{ warehouse: "Fontana, CA", qty: 4 }] },
    { sku: "SAMPLE-4", brand: "Continental", model: "TrueContact Tour", size: s, loadSpeed: "102H", cost: 96.2, map: 154.99, stock: [{ warehouse: "Ontario, CA", qty: 0 }, { warehouse: "Las Vegas, NV", qty: 16 }] },
    { sku: "SAMPLE-5", brand: "Cooper", model: "Endeavor", size: s, loadSpeed: "104H", cost: 88.5, map: 139.99, stock: [{ warehouse: "Ontario, CA", qty: 30 }] },
  ];
}

/* Retail from your markup, never advertised below the distributor's MAP. */
export function tireRetail(t, cfg) {
  const marked = sellPrice(t.cost, 0, cfg);
  return round2(Math.max(marked, Number(t.map) || 0));
}
export const tireOnHand = (t) => (t.stock || []).reduce((a, s) => a + (Number(s.qty) || 0), 0);
export const tireBestStock = (t) =>
  (t.stock || []).filter((s) => Number(s.qty) > 0).sort((a, b) => b.qty - a.qty)[0] || null;

/* Search the distributor for a size. Returns { tires, sample, distributor }.
   `sample` is true when it's placeholder data (no cloud, or the function
   isn't connected to a real account yet). */
export async function searchDistributorTires(size, cfg) {
  const s = String(size || "").trim();
  const decorate = (list, sample, distributor, error) => ({
    distributor: distributor || "US AutoForce",
    sample: !!sample,
    error: error || "",
    tires: (list || []).map((t) => ({ ...t, retail: tireRetail(t, cfg), onHand: tireOnHand(t) })),
  });
  try {
    const res = await cloud.invoke("tire-search", { size: s });
    return decorate(res.tires, res.sample, res.distributor, res.error);
  } catch {
    // offline / demo / function not deployed — show sample so the UI works
    return decorate(sampleTires(s), true, "US AutoForce");
  }
}
