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

/* Recommended actions and the verb each reads as in the finding. */
export const FIX_ACTIONS = [
  ["Replace", "replacing"],
  ["Repair", "repairing"],
  ["Resurface", "resurfacing"],
  ["Adjust", "adjusting"],
  ["Service", "servicing"],
  ["Further diagnosis", "further diagnosis"],
];

const verbFor = (action) => {
  const hit = FIX_ACTIONS.find(([a]) => a.toLowerCase() === String(action || "").toLowerCase());
  return hit ? hit[1] : String(action || "").toLowerCase();
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
    else s += ` Recommend ${verbFor(act)}${comp ? ` ${comp}` : ""}.`;
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
