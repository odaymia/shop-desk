/* Common customer complaints, grouped, for the quick "Customer states" filler.
   Tapping one drops it into the concern box so the writer doesn't retype the
   usual stuff. The shop can add its own to cfg.symptoms; these are the
   starting set. Pure data — no React, no storage. */

export const DEFAULT_SYMPTOMS = [
  ["Noises", ["Grinding noise when braking", "Squealing when braking", "Clicking when turning", "Rattle over bumps", "Humming/roaring from wheels", "Ticking/knocking from engine", "Whining noise"]],
  ["Brakes", ["Brakes feel soft/spongy", "Brake pedal pulsates", "Car pulls when braking", "Brake warning light on", "Parking brake won't hold"]],
  ["Engine / running", ["Check engine light on", "Engine won't start", "Hard to start", "Engine stalls", "Rough idle", "Loss of power", "Misfire/hesitation", "Poor fuel economy"]],
  ["Leaks / fluids", ["Oil leak", "Coolant leak", "Fluid spot under car", "Burning smell", "Low on oil", "Overheating"]],
  ["A/C & heat", ["A/C not cold", "Heater not warm", "Bad smell from vents", "Weak air flow", "Defroster not working"]],
  ["Steering / ride", ["Shakes at highway speed", "Vibration in steering wheel", "Pulls to one side", "Loose/wandering steering", "Rough ride", "Clunk over bumps"]],
  ["Electrical", ["Battery keeps dying", "Won't hold a charge", "Lights flickering", "Dash warning light on", "Power window stuck", "Dead battery"]],
  ["Tires", ["Tire losing air", "Uneven tire wear", "Needs rotation", "TPMS light on", "Flat tire"]],
  ["Maintenance", ["Here for oil change", "Due for service", "Pre-trip inspection", "State inspection", "Customer requests multi-point check"]],
];

/* The categorized list the picker shows — the shop's own symptoms merged in
   under a "Shop" group. cfg.symptoms is a flat list of strings. */
export function symptomGroups(cfg) {
  const groups = DEFAULT_SYMPTOMS.map(([cat, items]) => [cat, items]);
  const own = Array.isArray(cfg && cfg.symptoms) ? cfg.symptoms.filter((s) => String(s || "").trim()) : [];
  if (own.length) groups.unshift(["Shop", own]);
  return groups;
}

/* Append a symptom to the current concern text, one per line, no dupes. */
export function addSymptom(concern, symptom) {
  const cur = String(concern || "").trim();
  const s = String(symptom || "").trim();
  if (!s) return cur;
  const lines = cur ? cur.split("\n").map((l) => l.trim()) : [];
  if (lines.some((l) => l.toLowerCase() === s.toLowerCase())) return cur;
  return [...lines.filter(Boolean), s].join("\n");
}
