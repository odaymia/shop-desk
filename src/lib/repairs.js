/* Bridge the customer's stated concern to the parts and labor that fix it —
   the BAR sequence: the customer states the issue, then the estimate/RO carries
   the itemized work. We suggest the BAR-safe first step (a diagnosis or
   inspection) and point to the shop's own repair categories; the actual repair
   parts always come from the shop's canned jobs, never invented here.
   Pure — no React, no storage. */
import { parseConcern, symptomGroups } from "./symptoms.js";

/* Per concern category: the recommended first step (diagnose/inspect, in hours)
   and keywords that match the shop's own service-menu buttons. */
const CATEGORY_WORK = {
  "Warning lights": { diag: { label: "Diagnostic scan / trouble-code read", hours: 1 }, menu: ["diagnos", "scan", "check engine", "code"] },
  "Noises": { diag: { label: "Inspect and locate the noise", hours: 0.5 }, menu: ["brake", "suspension", "belt", "steering"] },
  "Brakes": { diag: { label: "Brake inspection", hours: 0.5 }, menu: ["brake"] },
  "Engine / running": { diag: { label: "Engine performance / drivability diagnosis", hours: 1 }, menu: ["tune", "diagnos", "fuel", "spark", "ignition", "engine"] },
  "Transmission / shifting": { diag: { label: "Transmission diagnosis / road test", hours: 1 }, menu: ["transmission", "trans", "cvt", "clutch"] },
  "Leaks / smells / smoke": { diag: { label: "Leak inspection / pressure test", hours: 0.5 }, menu: ["coolant", "radiator", "oil", "seal", "gasket", "cooling"] },
  "A/C & heat": { diag: { label: "A/C performance check", hours: 0.5 }, menu: ["a/c", "ac", "air condition", "heat", "climate"] },
  "Steering / ride / suspension": { diag: { label: "Steering & suspension inspection", hours: 0.5 }, menu: ["align", "suspension", "steering", "shock", "strut", "tire"] },
  "Electrical / lights": { diag: { label: "Electrical diagnosis", hours: 1 }, menu: ["battery", "electric", "light", "bulb", "charg"] },
  "Tires / wheels": { diag: { label: "Tire inspection", hours: 0.3 }, menu: ["tire", "rotat", "align", "balance", "wheel"] },
  "Maintenance / requested": { diag: null, menu: ["oil", "inspection", "service", "fluid", "battery", "brake", "filter"] },
};

/* Which concern categories a saved concern touches, via its matched symptoms. */
export function concernCategories(concern, cfg) {
  const { selected } = parseConcern(concern, cfg);
  const sel = new Set(selected.map((s) => s.toLowerCase()));
  const cats = [];
  for (const [cat, items] of symptomGroups(cfg)) {
    if (cat === "Shop") continue;
    if (items.some((i) => sel.has(i.toLowerCase()))) cats.push(cat);
  }
  return cats;
}

/* From the concern, the recommended diagnostics and the shop's service-menu
   buttons that address it. `diagnostics`: [{label, hours}] to add as labor.
   `menu`: the matching cfg.serviceMenu entries (opened with the shop's own
   canned jobs and pricing). */
export function suggestedWork(concern, cfg) {
  const cats = concernCategories(concern, cfg);
  const diagnostics = [];
  const seenDiag = new Set();
  const keywords = new Set();
  for (const cat of cats) {
    const w = CATEGORY_WORK[cat];
    if (!w) continue;
    if (w.diag && !seenDiag.has(w.diag.label)) {
      seenDiag.add(w.diag.label);
      diagnostics.push(w.diag);
    }
    for (const k of w.menu || []) keywords.add(k);
  }
  const kw = [...keywords];
  const seenMenu = new Set();
  const menu = (cfg && Array.isArray(cfg.serviceMenu) ? cfg.serviceMenu : []).filter((m) => {
    const hay = `${m.name || ""} ${m.category || ""}`.toLowerCase();
    if (!kw.some((k) => hay.includes(k))) return false;
    const id = m.id || m.name;
    if (seenMenu.has(id)) return false;
    seenMenu.add(id);
    return true;
  });
  return { categories: cats, diagnostics, menu };
}
