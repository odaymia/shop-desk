/* Common customer complaints, grouped, for the guided "Customer states"
   concern builder. The writer (or the customer, on a tablet) taps everything
   they mention and it prints on the ticket in plain, customer-understandable
   language — which is what the California BAR "Write It Right" guide requires
   of an estimate: a specific job description in terms the customer understands,
   no shop acronyms. The shop can add its own to cfg.symptoms.
   Pure data — no React, no storage. */

export const DEFAULT_SYMPTOMS = [
  ["Warning lights", ["Check engine light on", "Oil light on", "Battery light on", "Brake light on", "ABS (brake) light on", "Airbag light on", "Temperature / hot light on", "Low tire pressure light on", "Traction or slip light on", "A light I don't recognize is on"]],
  ["Noises", ["Grinding when I brake", "Squealing when I brake", "Clicking when I turn", "Rattling over bumps", "Humming or roaring while driving", "Ticking or knocking from the engine", "Whining sound", "Squeak or chirp under the hood", "Clunk when I take off or shift", "Noise only when it's cold"]],
  ["Brakes", ["Brakes feel soft or mushy", "Brake pedal shakes or pulses", "Pulls to one side when I brake", "Brakes squeak or grind", "Pedal sinks toward the floor", "Parking brake won't hold", "Takes longer to stop than it should"]],
  ["Engine / running", ["Won't start at all", "Takes a while to start", "Starts, then dies", "Shakes or rattles when stopped", "Feels weak or sluggish", "Stumbles or hesitates when I give it gas", "Using more gas than usual", "Runs rough until it warms up", "Backfires or pops", "Smells like gas"]],
  ["Transmission / shifting", ["Revs up but doesn't speed up", "Shifts hard or rough", "Won't go into gear", "Slow to move when I press the gas", "Jerks or shudders", "Stuck in one gear", "Grinds when I shift (stick shift)"]],
  ["Leaks / smells / smoke", ["Oil spot under the car", "Green or orange puddle (coolant)", "Red puddle (transmission)", "Something dripping under the car", "Burning smell", "Sweet syrup smell", "Smoke from the tailpipe", "Smoke under the hood", "Running hot / overheating", "Low on oil"]],
  ["A/C & heat", ["A/C not cold", "A/C cold sometimes, warm other times", "Heat not warm", "Bad smell from the vents", "Weak air from the vents", "Defroster not working", "Fan only works on high"]],
  ["Steering / ride / suspension", ["Shakes at highway speed", "Steering wheel shakes", "Pulls to one side while driving", "Steering feels loose", "Hard to steer", "Rough or bumpy ride", "Clunks over bumps", "Bounces a lot after bumps", "Sitting low on one corner"]],
  ["Electrical / lights", ["Battery keeps dying", "Won't hold a charge", "Dead battery", "Lights flicker or dim", "A light bulb is out", "Power window stuck", "Door locks not working", "Radio or screen not working", "Horn not working", "Wipers not working"]],
  ["Tires / wheels", ["Tire keeps going flat", "Tires wearing unevenly", "Needs a tire rotation", "Flat tire", "Nail or screw in a tire", "Shaking that gets worse with speed", "Wants new tires"]],
  ["Maintenance / requested", ["Here for an oil change", "Due for regular service", "Wants a full inspection", "Road-trip / pre-trip check", "Check the brakes", "Check and top off fluids", "Test the battery", "Wants a price for a specific repair", "Following up on a past visit"]],
];

/* Tab display for each category — a short label and an icon, so the concern
   builder reads as friendly tabs. Keyed by the category names above. */
export const CATEGORY_META = {
  "Warning lights": { icon: "🔆", short: "Dash lights" },
  Noises: { icon: "🔊", short: "Sounds" },
  Brakes: { icon: "🛑", short: "Brakes" },
  "Engine / running": { icon: "🔑", short: "Starting & running" },
  "Transmission / shifting": { icon: "⚙️", short: "Shifting" },
  "Leaks / smells / smoke": { icon: "💧", short: "Leaks & smells" },
  "A/C & heat": { icon: "🌡️", short: "Heat & A/C" },
  "Steering / ride / suspension": { icon: "🚗", short: "Steering & ride" },
  "Electrical / lights": { icon: "💡", short: "Lights & power" },
  "Tires / wheels": { icon: "🛞", short: "Tires" },
  "Maintenance / requested": { icon: "🔧", short: "Service / other" },
  Shop: { icon: "⭐", short: "Ours" },
};
export const categoryMeta = (name) => CATEGORY_META[name] || { icon: "•", short: name };

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
