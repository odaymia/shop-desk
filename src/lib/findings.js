/* The "fix builder": after the car is inspected, document what was found and
   what's recommended, tied back to the customer's stated concern — the
   cause/correction half of the estimate. It composes a clear, printable
   finding ("Inspected the brakes because the customer stated 'grinding when
   braking.' Found the front pads worn out; recommend replacing the front brake
   pads.") and a matching labor line the writer fills with parts + labor time
   (labor time will come from a licensed MOTOR feed later).
   Pure — no React, no storage. */

/* Concern category → the system the tech inspects, for the "inspected …"
   suggestions. Keyed to the DEFAULT_SYMPTOMS categories in symptoms.js. */
export const SYSTEM_FOR_CATEGORY = {
  "Warning lights": "the affected system",
  Noises: "the source of the noise",
  Brakes: "the brakes",
  "Engine / running": "the engine",
  "Transmission / shifting": "the transmission",
  "Leaks / smells / smoke": "for the leak",
  "A/C & heat": "the A/C and heating system",
  "Steering / ride / suspension": "the steering and suspension",
  "Electrical / lights": "the electrical system",
  "Tires / wheels": "the tires and wheels",
  "Maintenance / requested": "the vehicle",
};

/* Common inspection findings per concern area — click them instead of typing,
   so tickets go faster and nothing gets misspelled. Phrases are written to read
   naturally after "Found …". Keyed to the DEFAULT_SYMPTOMS categories. */
export const FINDINGS_BY_CATEGORY = {
  "Warning lights": [
    "stored diagnostic trouble codes present",
    "no codes stored — light is intermittent",
    "a sensor reading out of range",
    "a wiring or connector fault",
    "a failed component that needs replacement",
  ],
  Noises: [
    "brake pads worn and causing the noise",
    "a worn wheel bearing",
    "a worn or loose belt",
    "a worn suspension component",
    "a loose heat shield",
    "no noise present on the road test",
  ],
  Brakes: [
    "front brake pads worn out",
    "rear brake pads worn out",
    "front rotors scored or warped",
    "rear rotors scored or warped",
    "brake pads glazed",
    "brake fluid low",
    "brake fluid dirty or contaminated",
    "a caliper sticking",
    "a caliper leaking",
    "worn brake hardware",
    "the brakes within spec — no service needed",
  ],
  "Engine / running": [
    "worn spark plugs",
    "a failing ignition coil",
    "a fuel injector fault",
    "a vacuum leak",
    "a dirty engine air filter",
    "carbon buildup",
    "low compression on a cylinder",
    "the oil low and overdue for service",
  ],
  "Transmission / shifting": [
    "transmission fluid burnt or low",
    "the transmission slipping under load",
    "no fault present on the road test",
    "a broken or worn mount",
    "a needed software/relearn update",
  ],
  "Leaks / smells / smoke": [
    "an oil leak at the valve cover",
    "an oil leak at the oil pan",
    "a coolant leak at a hose",
    "a coolant leak at the water pump",
    "a transmission fluid leak",
    "no active leak found",
  ],
  "A/C & heat": [
    "refrigerant low — a leak is suspected",
    "the compressor not engaging",
    "a dirty cabin air filter",
    "a blend-door fault",
    "a weak blower motor",
    "the system operating normally",
  ],
  "Steering / ride / suspension": [
    "tires worn or cupped",
    "the wheels out of alignment",
    "a worn or leaking shock/strut",
    "a worn tie rod",
    "a worn ball joint",
    "a wheel out of balance",
    "no fault found",
  ],
  "Electrical / lights": [
    "a weak battery that failed the load test",
    "the alternator undercharging",
    "a burned-out bulb",
    "a blown fuse",
    "a corroded connection",
    "no fault found",
  ],
  "Tires / wheels": [
    "a tire worn to the wear bars",
    "uneven tire wear",
    "a nail or screw puncture",
    "a tire out of balance",
    "an alignment needed",
    "the tires within spec",
  ],
  "Maintenance / requested": [
    "the oil and filter due",
    "a dirty engine air filter",
    "a dirty cabin air filter",
    "worn wiper blades",
    "fluids low",
    "a weak battery",
    "everything within spec",
  ],
};

/* The findings to offer for a set of concern categories (deduped, in order).
   With no categories, offer them all so the builder still works. */
export function findingsForCategories(categories) {
  const cats = (categories && categories.length ? categories : Object.keys(FINDINGS_BY_CATEGORY)).filter((c) => FINDINGS_BY_CATEGORY[c]);
  const out = [];
  for (const c of cats) out.push([c, FINDINGS_BY_CATEGORY[c]]);
  return out;
}

/* Recommended actions, the verb (used with a component) and the noun (used
   without one) each reads as in the finding. */
export const FIX_ACTIONS = [
  ["Replace", "replacing", "replacement"],
  ["Repair", "repairing", "repair"],
  ["Resurface", "resurfacing", "resurfacing"],
  ["Adjust", "adjusting", "adjustment"],
  ["Service", "servicing", "service"],
  ["Further diagnosis", "further diagnosis", "further diagnosis"],
];

const actionEntry = (action) => FIX_ACTIONS.find(([a]) => a.toLowerCase() === String(action || "").toLowerCase());
const verbFor = (action) => {
  const e = actionEntry(action);
  return e ? e[1] : String(action || "").toLowerCase();
};
const nounFor = (action) => {
  const e = actionEntry(action);
  return e ? e[2] : String(action || "").toLowerCase();
};

const clean = (s) => String(s || "").trim().replace(/[.\s]+$/, "");

/* Build the finding sentence from the parts the tech filled in. Only the
   pieces present are included, so a half-filled builder still reads well. */
export function composeFinding({ inspected, concern, found, action, component } = {}) {
  const insp = clean(inspected);
  const con = clean(concern).replace(/\n+/g, "; ");
  const fnd = clean(found);
  const comp = clean(component);
  const act = clean(action);

  let s = "";
  if (insp) s += `Inspected ${insp}`;
  else s += "Inspected the vehicle";
  if (con) s += ` because the customer stated: ${con}`;
  s += ".";
  if (fnd) s += ` Found ${fnd}.`;
  if (act) {
    if (/further diagnosis/i.test(act)) s += " Recommend further diagnosis.";
    else if (comp) s += ` Recommend ${verbFor(act)} ${comp}.`;
    else s += ` Recommend ${nounFor(act)}.`;
  }
  return s.trim();
}

/* A short labor-line description for the correction, e.g. "Replace front brake
   pads" — what the writer then puts parts and a labor time against. */
export function fixLaborDescription({ action, component } = {}) {
  const act = clean(action);
  const comp = clean(component);
  if (!act || /further diagnosis/i.test(act)) return comp ? `Diagnose ${comp}` : "Further diagnosis";
  return comp ? `${act} ${comp}` : act;
}

/* Append a finding to the running findings text, one per line, no dupes. */
export function addFinding(findings, sentence) {
  const cur = String(findings || "").trim();
  const s = String(sentence || "").trim();
  if (!s) return cur;
  const lines = cur ? cur.split("\n").map((l) => l.trim()) : [];
  if (lines.some((l) => l.toLowerCase() === s.toLowerCase())) return cur;
  return [...lines.filter(Boolean), s].join("\n");
}
