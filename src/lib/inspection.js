/* Digital Vehicle Inspection (DVI).

   A tech walks the car, marks each point Good / Attention / Needs service (or
   N/A), adds notes and photos, and flags recommended work with a price. The
   flagged items become estimate lines, and the whole thing prints and can be
   sent to the customer. This is the pure part — the template, the states, and
   the roll-up math (summary + which items become recommended work). No React,
   no storage, no camera. Tested in tests/inspection.test.js.

   A performed inspection stored on the order:
     order.inspection = {
       at, by,
       items: { [itemId]: { status, note, photos: [mediaKey], recLabel, recPrice } }
     }
   Photos live in the media bucket (sd:photo:*); the order holds only the keys. */

export const INSPECTION_STATES = [
  { id: "good", label: "Good", short: "OK" },
  { id: "advise", label: "Attention", short: "!" },
  { id: "fail", label: "Needs service", short: "X" },
  { id: "na", label: "N/A", short: "—" },
];
export const stateLabel = (s) => (INSPECTION_STATES.find((x) => x.id === s) || {}).label || "";
// Items the customer should see as recommended work.
export const FLAGGED = ["advise", "fail"];

/* A solid general-service inspection. Editable later in Settings; for now this
   is the book every DVI starts from. */
export const DEFAULT_INSPECTION = [
  {
    name: "Road test & exterior",
    items: [
      { id: "warnlights", label: "Warning / check-engine lights" },
      { id: "wipers", label: "Wiper blades & washers" },
      { id: "extlights", label: "Exterior lights" },
      { id: "horn", label: "Horn" },
      { id: "glass", label: "Windshield & glass" },
    ],
  },
  {
    name: "Under hood",
    items: [
      { id: "oil", label: "Engine oil level & condition" },
      { id: "coolant", label: "Coolant level & condition" },
      { id: "brakefluid", label: "Brake fluid" },
      { id: "psfluid", label: "Power steering fluid" },
      { id: "transfluid", label: "Transmission fluid" },
      { id: "battery", label: "Battery & terminals" },
      { id: "airfilter", label: "Engine air filter", recLabel: "Engine air filter replacement", recPrice: 45 },
      { id: "cabinfilter", label: "Cabin air filter", recLabel: "Cabin air filter replacement", recPrice: 55 },
      { id: "belts", label: "Belts & hoses" },
    ],
  },
  {
    name: "Brakes",
    items: [
      { id: "frontbrakes", label: "Front pads & rotors", recLabel: "Front brake service" },
      { id: "rearbrakes", label: "Rear pads & rotors", recLabel: "Rear brake service" },
      { id: "brakelines", label: "Brake lines & hoses" },
      { id: "parkbrake", label: "Parking brake" },
    ],
  },
  {
    name: "Tires & wheels",
    items: [
      { id: "lftire", label: "LF tire tread & condition" },
      { id: "rftire", label: "RF tire tread & condition" },
      { id: "lrtire", label: "LR tire tread & condition" },
      { id: "rrtire", label: "RR tire tread & condition" },
      { id: "tirepsi", label: "Tire pressure set to spec" },
    ],
  },
  {
    name: "Steering & suspension",
    items: [
      { id: "shocks", label: "Shocks & struts" },
      { id: "balljoints", label: "Ball joints & tie rods" },
      { id: "cvaxles", label: "CV axles & boots" },
      { id: "alignment", label: "Alignment / tire wear", recLabel: "Wheel alignment", recPrice: 120 },
    ],
  },
  {
    name: "Underneath",
    items: [
      { id: "exhaust", label: "Exhaust system" },
      { id: "leaks", label: "Fluid leaks" },
      { id: "mounts", label: "Engine & transmission mounts" },
    ],
  },
];

/* Flatten a template to its items, in order, carrying the category name and any
   default recommendation. */
export function inspectionItems(template) {
  const out = [];
  for (const cat of template || DEFAULT_INSPECTION) {
    for (const it of cat.items || []) out.push({ ...it, category: cat.name });
  }
  return out;
}

/* A fresh, empty inspection for a ticket — every point present but unmarked. */
export function startInspection(template) {
  const items = {};
  for (const it of inspectionItems(template)) items[it.id] = { status: "", note: "", photos: [] };
  return { at: Date.now(), items };
}

/* Counts by state plus how many points are still unmarked and how many photos
   were taken — for the summary chip on the ticket. */
export function inspectionSummary(inspection) {
  const c = { good: 0, advise: 0, fail: 0, na: 0, pending: 0, photos: 0, total: 0 };
  const items = (inspection && inspection.items) || {};
  for (const id in items) {
    const it = items[id] || {};
    c.total += 1;
    const s = it.status || "pending";
    if (c[s] === undefined) c.pending += 1;
    else c[s] += 1;
    c.photos += (it.photos || []).length;
  }
  return c;
}

export const inspectionDone = (inspection) => {
  const s = inspectionSummary(inspection);
  return s.total > 0 && s.pending === 0;
};

/* The recommended work: every point marked Attention or Needs service, most
   urgent first, with its label/price (the tech's entry, else the template
   default, else the point's own name). These become estimate lines. */
export function inspectionRecommendations(inspection, template) {
  const defs = {};
  for (const it of inspectionItems(template)) defs[it.id] = it;
  const out = [];
  const items = (inspection && inspection.items) || {};
  for (const id in items) {
    const it = items[id] || {};
    if (!FLAGGED.includes(it.status)) continue;
    const def = defs[id] || {};
    const label = String(it.recLabel || def.recLabel || def.label || "Recommended service").trim();
    out.push({
      id,
      label,
      price: Math.max(0, Number(it.recPrice ?? def.recPrice) || 0),
      urgent: it.status === "fail",
      note: String(it.note || "").trim(),
      photos: (it.photos || []).slice(),
    });
  }
  out.sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0));
  return out;
}

/* Normalize an edited template (Settings) — drop empty categories/items, keep
   ids stable, coerce prices. */
export function normalizeInspection(template) {
  const out = [];
  for (const cat of template || []) {
    const items = (cat.items || [])
      .filter((it) => String(it.label || "").trim())
      .map((it) => ({
        id: it.id || slug(it.label),
        label: String(it.label).trim(),
        ...(it.recLabel ? { recLabel: String(it.recLabel).trim() } : {}),
        ...(Number(it.recPrice) > 0 ? { recPrice: Number(it.recPrice) } : {}),
      }));
    if (String(cat.name || "").trim() && items.length) out.push({ name: String(cat.name).trim(), items });
  }
  return out;
}

const slug = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24) || `i${Math.random().toString(36).slice(2, 8)}`;
