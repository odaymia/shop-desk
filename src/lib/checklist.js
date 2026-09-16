/* The service checklist: the walk-around every oil change gets. Filled
   from the keyboard on the ticket, printed on the invoice, shown in the
   portal. Pure functions only.

   A config item: { id, label, kind: "choice" | "text" | "depth" | "pressure", options,
   value (the default), auto, remember }.
   - auto: words on a ticket line that mean the item was replaced, e.g.
     "oil filter". Alternatives split on "|"; every word must appear;
     a "-word" must not ("air filter -cabin").
   - remember: start from the car's last visit (tire pressure).
   A filled item: { id, label, kind, value, auto: true when the ticket
   set it }. */

export const CHECK_STATES = ["Checked OK", "Level OK", "Added", "Replaced", "At your request", "Can't check"];
export const REPLACED = "Replaced";
/* Mark an item Recommend and it prints on the receipt as a recommended
   service with the estimated price set on the item (recommendPrice). */
export const RECOMMEND = "Recommend";

export const DEFAULT_CHECKLIST = [
  { id: "oil", label: "Engine oil", kind: "choice", options: ["Replaced", "Level OK", "Added", "Checked OK", "At your request"], value: "Level OK", auto: "oil change | motor oil | engine oil" },
  { id: "oilFilter", label: "Oil filter", kind: "choice", options: ["Replaced", "Checked OK", "Recommend", "At your request"], value: "Checked OK", auto: "oil filter" },
  { id: "rearDiff", label: "Rear diff fluid", kind: "choice", options: ["At your request", "Level OK", "Added", "Replaced", "Recommend", "Can't check", "N/A"], value: "At your request", auto: "rear diff | rear differential", recommendPrice: 90, recommendLabel: "Rear differential fluid service" },
  { id: "trans", label: "Transmission fluid", kind: "choice", options: ["Level OK", "Added", "Replaced", "Recommend", "At your request", "Sealed", "Can't check"], value: "Level OK", auto: "transmission fluid | transmission flush | transmission service", recommendPrice: 180, recommendLabel: "Transmission fluid service" },
  { id: "wipers", label: "Wiper blades", kind: "choice", options: ["Checked OK", "Replaced", "Recommend", "At your request"], value: "Checked OK", auto: "wiper", recommendPrice: 25, recommendLabel: "Wiper blade replacement" },
  { id: "airFilter", label: "Air filter", kind: "choice", options: ["Checked OK", "Replaced", "Recommend", "At your request"], value: "Checked OK", auto: "air filter -cabin | engine filter", recommendPrice: 30, recommendLabel: "Engine air filter replacement" },
  { id: "cabinFilter", label: "Cabin air filter", kind: "choice", options: ["Checked OK", "Replaced", "Recommend", "At your request", "Can't check", "N/A"], value: "Checked OK", auto: "cabin filter | cabin air", recommendPrice: 40, recommendLabel: "Cabin air filter replacement" },
  { id: "brakeFluid", label: "Brake fluid", kind: "choice", options: ["Sensor OK", "Level OK", "Added", "Replaced", "Recommend", "At your request"], value: "Sensor OK", auto: "brake fluid | brake flush", recommendPrice: 110, recommendLabel: "Brake fluid flush" },
  { id: "psFluid", label: "Power steering fluid", kind: "choice", options: ["Full", "Added", "Replaced", "Recommend", "At your request", "N/A (electric)", "Can't check"], value: "Full", auto: "power steering fluid | power steering flush", recommendPrice: 100, recommendLabel: "Power steering fluid flush" },
  { id: "coolant", label: "Radiator fluid", kind: "choice", options: ["Level OK", "Added", "Replaced", "Recommend", "Can't check", "At your request"], value: "Level OK", auto: "coolant flush | radiator flush | coolant service | antifreeze", recommendPrice: 130, recommendLabel: "Coolant flush and fill" },
  { id: "washer", label: "Windshield wash fluid", kind: "choice", options: ["Added", "Full", "Can't check"], value: "Added", auto: "" },
  { id: "tirePsi", label: "Tire pressure", kind: "pressure", value: "F35 R35", auto: "", remember: true },
  { id: "frontDiff", label: "Front diff fluid", kind: "choice", options: ["At your request", "Level OK", "Added", "Replaced", "Recommend", "Can't check", "N/A"], value: "At your request", auto: "front diff | front differential | transfer case", recommendPrice: 90, recommendLabel: "Front differential fluid service" },
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

/* Keep an already-filled checklist in step with the ticket as services
   are added or removed after it was first done. An item whose service is
   now on the ticket flips to Replaced; an item the ticket had flipped,
   but whose service has since come off, reverts to what it was before
   (the value it held is remembered in `prior`), or to its default. A
   manual choice on an item the ticket doesn't drive is left untouched.
   Returns the same array when nothing changed, so the caller can skip a
   save. */
export function syncChecklist(items, lines, cfgItems) {
  if (!Array.isArray(items) || !items.length) return items;
  const cfg = cfgItems && cfgItems.length ? cfgItems : DEFAULT_CHECKLIST;
  const autoOf = (id) => (cfg.find((x) => x.id === id) || {}).auto || "";
  const defOf = (id) => (cfg.find((x) => x.id === id) || {}).value || "";
  let changed = false;
  const next = items.map((it) => {
    if (!it || it.kind !== "choice") return it;
    const words = autoOf(it.id);
    if (!words) return it; // item the ticket can't drive: leave the manual value
    const onTicket = replacedOnTicket({ auto: words }, lines);
    if (onTicket) {
      if (it.value === REPLACED && it.auto) return it; // already right
      changed = true;
      /* remember the value we're covering so removing the service can put
         it back; if it was already auto, keep whatever was stashed */
      const prior = it.auto ? it.prior : it.value;
      return { ...it, value: REPLACED, auto: true, prior };
    }
    if (it.auto) {
      /* the ticket had flipped this on; the service is gone now, so undo */
      changed = true;
      const back = it.prior != null && it.prior !== "" ? it.prior : defOf(it.id);
      const rest = { ...it };
      delete rest.prior;
      return { ...rest, value: back, auto: false };
    }
    return it;
  });
  return changed ? next : items;
}

/* Options for an item: the config's list, always including Replaced so
   an auto-marked item can be cycled back to it, and Recommend on any
   serviceable item (one that carries a recommend estimate on it, its
   config, or the standard list) so the option shows even when a saved
   checklist was set up before Recommend existed. */
export function optionsOf(item, cfgItems) {
  const c = (cfgItems || []).find((x) => x.id === item.id) || item;
  const d = DEFAULT_CHECKLIST.find((x) => x.id === item.id) || {};
  const o = Array.isArray(c.options) && c.options.length ? [...c.options] : [...CHECK_STATES];
  if (!o.includes(REPLACED)) o.push(REPLACED);
  const recommendable =
    Number(item.recommendPrice) > 0 || Number(c.recommendPrice) > 0 || Number(d.recommendPrice) > 0 || !!(c.recommendLabel || d.recommendLabel);
  if (recommendable && !o.includes(RECOMMEND)) o.push(RECOMMEND);
  return o;
}

/* A fresh checklist for a ticket: defaults, ticket lines marking what
   was replaced, and the car's last values for remembered items. */
export function startChecklist(cfgItems, lines, prior) {
  const src = cfgItems && cfgItems.length ? cfgItems : DEFAULT_CHECKLIST;
  return src
    .filter((it) => it && it.label && it.active !== false)
    .map((it) => {
      /* older configs saved tire pressure as free text; show it as the
         front/rear number pair now */
      const kind = it.id === "tirePsi" && (it.kind || "text") === "text" ? "pressure" : it.kind || "choice";
      const auto = kind === "choice" && replacedOnTicket(it, lines);
      let value = auto ? REPLACED : it.value || "";
      if (!auto && it.remember && prior) {
        const p = prior.find((x) => x.id === it.id);
        if (p && p.value) value = p.value;
      }
      const item = { id: it.id, label: it.label, kind, value, auto };
      /* carry the recommend estimate along so the receipt can price a
         recommended item without reaching back into settings */
      if (Number(it.recommendPrice) > 0) item.recommendPrice = Number(it.recommendPrice);
      if (it.recommendLabel) item.recommendLabel = it.recommendLabel;
      return item;
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

/* Tire pressure is stored as a single string ("F35 R35") so it prints and
   syncs like any other item, but it's entered as two numbers, front and
   rear. These parse and rebuild that string. */
export function parsePressure(value) {
  const s = String(value || "");
  const f = (s.match(/F\s*(\d+)/i) || [])[1] || "";
  const r = (s.match(/R\s*(\d+)/i) || [])[1] || "";
  return { f, r };
}
export function formatPressure(f, r) {
  const ff = String(f || "").replace(/\D/g, "").slice(0, 3);
  const rr = String(r || "").replace(/\D/g, "").slice(0, 3);
  if (!ff && !rr) return "";
  return `F${ff} R${rr}`.trim();
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

/* Services the tech marked Recommend on the checklist, for the receipt:
   each with the wording the customer reads and an estimated price. The
   price and label come from the item's config (recommendPrice /
   recommendLabel), or from the item itself when startChecklist copied
   them on; the label falls back to the item's own name. */
export function recommendedServices(items, cfgItems) {
  const cfg = cfgItems && cfgItems.length ? cfgItems : DEFAULT_CHECKLIST;
  const pick = (...vals) => vals.find((v) => v != null && v !== "");
  return (items || [])
    .filter((it) => it && it.value === RECOMMEND)
    .map((it) => {
      const c = cfg.find((x) => x.id === it.id) || {};
      const d = DEFAULT_CHECKLIST.find((x) => x.id === it.id) || {}; // standard fallback for older configs
      const price = Number(pick(it.recommendPrice, c.recommendPrice, d.recommendPrice)) || 0;
      const label = String(pick(it.recommendLabel, c.recommendLabel, d.recommendLabel) || "").trim() || String(it.label || c.label || "Service");
      return { id: it.id, label, price };
    });
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
      const kind = r.kind === "text" || r.kind === "depth" || r.kind === "pressure" ? r.kind : "choice";
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
        recommendPrice: Number(r.recommendPrice) || 0,
        recommendLabel: String(r.recommendLabel || "").trim(),
      };
    });
}
