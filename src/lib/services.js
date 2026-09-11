/* The service menu on a ticket: one button per kind of work, in the
   order the shop sells it. Oil change opens the oil change picker; every
   other button opens the canned jobs filed under its category. Pure. */

export const DEFAULT_SERVICE_MENU = [
  { id: "oil", name: "Oil change", color: "red", oil: true },
  { id: "brakes", name: "Brakes", color: "red", category: "Brakes" },
  { id: "tires", name: "Tires", color: "red", category: "Tires" },
  { id: "air", name: "Air filters", color: "green", category: "Air filters" },
  { id: "cabin", name: "Cabin air filters", color: "green", category: "Cabin air filters" },
  { id: "trans", name: "Transmission", color: "green", category: "Transmission services" },
  { id: "radiator", name: "Radiator", color: "green", category: "Radiator services" },
  { id: "brakeFluid", name: "Brake fluid", color: "green", category: "Brake fluid services" },
  { id: "fuel", name: "Fuel system", color: "green", category: "Fuel system services" },
  { id: "steering", name: "Power steering", color: "green", category: "Power steering services" },
  { id: "diff", name: "Differential fluid", color: "green", category: "Differential fluid services" },
];

const norm = (s) => String(s || "").trim().toLowerCase();

/* Jobs filed under a menu button's category, case and spacing aside */
export function jobsInCategory(jobs, category) {
  const c = norm(category);
  if (!c) return [];
  return Object.values(jobs || {}).filter((j) => j && j.active !== false && norm(j.category) === c);
}

/* Category names the menu knows, for the canned job form's suggestions */
export function menuCategories(menu) {
  const seen = new Set();
  return (menu || [])
    .map((m) => String(m.category || "").trim())
    .filter((c) => c && !seen.has(c.toLowerCase()) && seen.add(c.toLowerCase()));
}

/* Settings rows come back loose */
export function normalizeMenu(rows) {
  return (rows || [])
    .filter((r) => r && String(r.name || "").trim())
    .map((r, i) => ({
      id: r.id || "svc" + (i + 1),
      name: String(r.name).trim(),
      color: r.color === "green" ? "green" : "red",
      oil: !!r.oil,
      category: r.oil ? "" : String(r.category || r.name).trim(),
    }));
}
