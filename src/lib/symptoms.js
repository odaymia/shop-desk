/* Common customer complaints, grouped, for the guided "Customer states"
   concern builder. The writer (or the customer, on a tablet) taps everything
   they mention and it prints on the ticket in plain, customer-understandable
   language — which is what the California BAR "Write It Right" guide requires
   of an estimate: a specific job description in terms the customer understands,
   no shop acronyms. The shop can add its own to cfg.symptoms.
   Pure data — no React, no storage. */

export const DEFAULT_SYMPTOMS = [
  ["Warning lights", ["Check engine light on", "Oil light on", "Battery/charging light on", "Brake warning light on", "ABS light on", "Airbag light on", "Temperature light on", "Tire pressure (TPMS) light on", "Traction/stability light on", "A warning light I don't recognize"]],
  ["Noises", ["Grinding noise when braking", "Squealing when braking", "Clicking when turning", "Rattle over bumps", "Humming or roaring from the wheels", "Ticking or knocking from the engine", "Whining noise", "Squeal or chirp from the belt", "Clunk when shifting", "Noise only when cold"]],
  ["Brakes", ["Brakes feel soft or spongy", "Brake pedal pulsates", "Car pulls to one side when braking", "Brakes grabbing or grinding", "Pedal goes to the floor", "Parking brake won't hold", "Brakes take too long to stop"]],
  ["Engine / running", ["Engine won't start", "Hard to start", "Engine stalls", "Rough idle", "Loss of power", "Misfire or hesitation", "Poor fuel economy", "Runs rough when cold", "Backfires", "Smells like gas"]],
  ["Transmission / shifting", ["Slipping when accelerating", "Hard or rough shifting", "Won't go into gear", "Delayed engagement", "Jerks or shudders", "Stuck in one gear", "Grinding when shifting (manual)"]],
  ["Leaks / smells / smoke", ["Oil leak", "Coolant leak", "Transmission fluid leak", "Fluid spot under the car", "Burning smell", "Sweet smell (coolant)", "Smoke from the exhaust", "Smoke under the hood", "Overheating", "Low on oil"]],
  ["A/C & heat", ["A/C not cold", "A/C blows warm sometimes", "Heater not warm", "Bad smell from the vents", "Weak air flow", "Defroster not working", "Fan only works on high"]],
  ["Steering / ride / suspension", ["Shakes at highway speed", "Vibration in the steering wheel", "Pulls to one side", "Loose or wandering steering", "Hard to steer", "Rough ride", "Clunk over bumps", "Bounces after bumps", "Sits low on one corner"]],
  ["Electrical / lights", ["Battery keeps dying", "Won't hold a charge", "Dead battery", "Lights flickering", "A light is out", "Power window stuck", "Door locks not working", "Radio or screen not working", "Horn not working", "Wipers not working"]],
  ["Tires / wheels", ["Tire losing air", "Uneven tire wear", "Needs a rotation", "Flat tire", "Tire has a nail or screw", "Vibration that changes with speed", "Wants new tires"]],
  ["Maintenance / requested", ["Here for an oil change", "Due for scheduled service", "Requests a multi-point inspection", "Pre-trip / road-trip check", "Brake inspection", "Check fluids and top off", "Battery test", "Wants an estimate for a specific repair", "Following up on a prior visit"]],
];

/* The categorized list the picker shows — the shop's own symptoms merged in
   under a "Shop" group. cfg.symptoms is a flat list of strings. */
export function symptomGroups(cfg) {
  const groups = DEFAULT_SYMPTOMS.map(([cat, items]) => [cat, items]);
  const own = Array.isArray(cfg && cfg.symptoms) ? cfg.symptoms.filter((s) => String(s || "").trim()) : [];
  if (own.length) groups.unshift(["Shop", own]);
  return groups;
}

/* Every symptom string across all groups, for matching a saved concern back
   to the chips that made it. */
export function allSymptomItems(cfg) {
  return symptomGroups(cfg).flatMap(([, items]) => items);
}

/* Append a symptom to the current concern text, one per line, no dupes.
   Kept for the quick single-tap add. */
export function addSymptom(concern, symptom) {
  const cur = String(concern || "").trim();
  const s = String(symptom || "").trim();
  if (!s) return cur;
  const lines = cur ? cur.split("\n").map((l) => l.trim()) : [];
  if (lines.some((l) => l.toLowerCase() === s.toLowerCase())) return cur;
  return [...lines.filter(Boolean), s].join("\n");
}

/* Split a saved concern back into the known symptoms that were picked and any
   free-text the writer typed, so reopening the builder shows what's already
   there. */
export function parseConcern(concern, cfg) {
  const known = new Map(allSymptomItems(cfg).map((s) => [s.toLowerCase(), s]));
  const selected = [];
  const extra = [];
  for (const raw of String(concern || "").split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    const hit = known.get(l.toLowerCase());
    if (hit) selected.push(hit);
    else extra.push(l);
  }
  return { selected, extra: extra.join("\n") };
}

/* Build the concern text from picked symptoms plus any free text — each on its
   own line, plain language, de-duplicated, order preserved. */
export function composeConcern(selected, extra) {
  const out = [];
  const seen = new Set();
  const push = (l) => {
    const t = String(l || "").trim();
    const k = t.toLowerCase();
    if (t && !seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  };
  for (const s of selected || []) push(s);
  for (const l of String(extra || "").split("\n")) push(l);
  return out.join("\n");
}
