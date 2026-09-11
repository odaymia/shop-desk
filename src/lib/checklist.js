/* The service checklist: the walk-around every oil change gets. Filled
   from the keyboard on the ticket, printed on the invoice, shown in the
   portal. Pure functions only.

   A config item: { id, label, kind: "choice" | "text" | "depth", options,
   value (the default), auto, remember }.
   - auto: words on a ticket line that mean the item was replaced, e.g.
     "oil filter". Alternatives split on "|"; every word must appear;
     a "-word" must not ("air filter -cabin").
   - remember: start from the car's last visit (tire pressure).
   A filled item: { id, label, kind, value, auto: true when the ticket
   set it }. */

export const CHECK_STATES = ["Checked OK", "Level OK", "Added", "Replaced", "At your request", "Can't check"];
export const REPLACED = "Replaced";

export const DEFAULT_CHECKLIST = [
  { id: "oil", label: "Engine oil", kind: "choice", options: ["Replaced", "Level OK", "Added", "Checked OK", "At your request"], value: "Level OK", auto: "oil change | motor oil | engine oil" },
  { id: "oilFilter", label: "Oil filter", kind: "choice", options: ["Replaced", "Checked OK", "At your request"], value: "Checked OK", auto: "oil filter" },
  { id: "rearDiff", label: "Rear diff fluid", kind: "choice", options: ["At your request", "Level OK", "Added", "Replaced", "Can't check", "N/A"], value: "At your request", auto: "rear diff | rear differential" },
  { id: "trans", label: "Transmission fluid", kind: "choice", options: ["Level OK", "Added", "Replaced", "At your request", "Sealed", "Can't check"], value: "Level OK", auto: "transmission fluid | transmission flush | transmission service" },
  { id: "wipers", label: "Wiper blades", kind: "choice", options: ["Checked OK", "Replaced", "At your request"], value: "Checked OK", auto: "wiper" },
  { id: "airFilter", label: "Air filter", kind: "choice", options: ["Checked OK", "Replaced", "At your request"], value: "Checked OK", auto: "air filter -cabin | engine filter" },
  { id: "cabinFilter", label: "Cabin air filter", kind: "choice", options: ["Checked OK", "Replaced", "At your request", "Can't check", "N/A"], value: "Checked OK", auto: "cabin filter | cabin air" },
  { id: "brakeFluid", label: "Brake fluid", kind: "choice", options: ["Sensor OK", "Level OK", "Added", "Replaced", "At your request"], value: "Sensor OK", auto: "brake fluid | brake flush" },
  { id: "psFluid", label: "Power steering fluid", kind: "choice", options: ["Full", "Added", "Replaced", "At your request", "N/A (electric)", "Can't check"], value: "Full", auto: "power steering fluid | power steering flush" },
  { id: "coolant", label: "Radiator fluid", kind: "choice", options: ["Level OK", "Added", "Replaced", "Can't check", "At your request"], value: "Level OK", auto: "coolant flush | radiator flush | coolant service | antifreeze" },
  { id: "washer", label: "Windshield wash fluid", kind: "choice", options: ["Added", "Full", "Can't check"], value: "Added", auto: "" },
  { id: "tirePsi", label: "Tire pressure", kind: "text", value: "F35 R35", auto: "", remember: true },
  { id: "frontDiff", label: "Front diff fluid", kind: "choice", options: ["At your request", "Level OK", "Added", "Replaced", "Can't check", "N/A"], value: "At your request", auto: "front diff | front differential | transfer case" },
  { id: "lfDepth", label: "Front driver side tire depth", kind: "depth", value: "", auto: "" },
  { id: "rfDepth", label: "Front passenger side tire depth", kind: "depth", value: "", auto: "" },
  { id: "lrDepth", label: "Rear driver side tire depth", kind: "depth", value: "", auto: "" },
  { id: "rrDepth", label: "Rear passenger side tire depth", kind: "depth", value: "", auto: "" },
];

/* "air filter -cabin | engine filter" against one line's text */
export function matchesAuto(auto, text) {
  const t = String(text || "").toLowerCase();
  return String(auto || "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .some((alt) =>
      alt
        .toLowerCase()
        .split(/\s+/)
        .every((w) => (w.startsWith("-") ? !t.includes(w.slice(1)) : t.includes(w)))
    );
}

/* Was this item's part or service sold on the ticket? Each line is
   matched on its own, so "-cabin" on a cabin filter line doesn't hide
   an engine air filter on another. */
export function replacedOnTicket(item, lines) {
  if (!item || !item.auto) return false;
  return (lines || []).some(
    (l) => l && (l.kind === "part" || l.kind === "labor" || l.kind === "sublet") && matchesAuto(item.auto, `${l.description || ""} ${l.job || ""}`)
  );
}

/* Options for an item: the config's list, always including Replaced so
   an auto-marked item can be cycled back to it. */
export function optionsOf(item, cfgItems) {
  const c = (cfgItems || []).find((x) => x.id === item.id) || item;
  const o = Array.isArray(c.options) && c.options.length ? c.options : CHECK_STATES;
  return o.includes(REPLACED) ? o : [...o, REPLACED];
}

/* A fresh checklist for a ticket: defaults, ticket lines marking what
   was replaced, and the car's last values for remembered items. */
export function startChecklist(cfgItems, lines, prior) {
  const src = cfgItems && cfgItems.length ? cfgItems : DEFAULT_CHECKLIST;
  return src
    .filter((it) => it && it.label && it.active !== false)
    .map((it) => {
      const kind = it.kind || "choice";
      const auto = kind === "choice" && replacedOnTicket(it, lines);
      let value = auto ? REPLACED : it.value || "";
      if (!auto && it.remember && prior) {
        const p = prior.find((x) => x.id === it.id);
        if (p && p.value) value = p.value;
      }
      return { id: it.id, label: it.label, kind, value, auto };
    });
}

/* Space bar: the next choice, wrapping */
export function cycle(options, value, dir = 1) {
  if (!options.length) return value;
  const i = options.indexOf(value);
  return options[(i + dir + options.length) % options.length];
}

/* Stepping onto a blank tire depth copies the last one entered, so
   four matching tires are Enter, Enter, Enter, Enter. */
export function withDepthDefault(items, n) {
  const it = items[n];
  if (!it || it.kind !== "depth" || it.value) return items;
  const prev = items
    .slice(0, n)
    .reverse()
    .find((x) => x.kind === "depth" && x.value);
  if (!prev) return items;
  return items.map((x, i) => (i === n ? { ...x, value: prev.value } : x));
}

export function displayValue(item) {
  if (!item) return "";
  if (item.kind === "depth") return item.value ? `${item.value}/32nds` : "";
  return item.value || "";
}

/* Label and text pairs for the invoice and the portal */
export function checklistSummary(items) {
  return (items || []).map((it) => ({ label: it.label, text: displayValue(it) }));
}

/* The car's last filled checklist, for remembered items */
export function priorChecklist(orders, vehicleId, exceptId) {
  if (!vehicleId) return null;
  const o = Object.values(orders || {})
    .filter((x) => x.vehicleId === vehicleId && x.id !== exceptId && x.status !== "deleted" && x.checklist && x.checklist.items)
    .sort((a, b) => (b.invoicedAt || b.createdAt || 0) - (a.invoicedAt || a.createdAt || 0))[0];
  return o ? o.checklist.items : null;
}

/* Settings rows come back with options typed as "a, b, c" */
export function normalizeChecklist(rows) {
  return (rows || [])
    .filter((r) => r && String(r.label || "").trim())
    .map((r, i) => {
      const kind = r.kind === "text" || r.kind === "depth" ? r.kind : "choice";
      const options = Array.isArray(r.options)
        ? r.options
        : String(r.options || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
      return {
        id: r.id || "ck" + (i + 1),
        label: String(r.label).trim(),
        kind,
        options: kind === "choice" ? options : [],
        value: String(r.value || "").trim(),
        auto: kind === "choice" ? String(r.auto || "").trim() : "",
        remember: !!r.remember,
      };
    });
}
