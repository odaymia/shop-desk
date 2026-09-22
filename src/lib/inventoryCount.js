/* Physical inventory counts — the "take inventory / enter inventory" workflow.

   Pick a category, walk the items in a fixed order (the same order the count
   sheet prints and the enter screen keys down), record what's actually on the
   shelf, then compare to what the computer thinks is there. This module is the
   pure part: which items to count, in what order, and the variance math for the
   report at the end (what's off, total units off, total dollars off). No React,
   no storage — tested in tests/inventoryCount.test.js. */
import { itemCategory } from "./inventoryReports.js";

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const countable = (p) => !!p && p.active !== false && !p.tire;

/* Categories that have something to count, in display order (matches the
   Inventory filter bar). */
export function countCategories(parts) {
  const set = new Set();
  for (const p of Object.values(parts || {})) {
    if (!countable(p)) continue;
    set.add(itemCategory(p));
  }
  return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

/* The ordered list of items to count for a category ("all" = everything). A
   stable snapshot taken when the count starts: id, number, description, bin,
   cost, and the expected on-hand at that moment — so the sheet, the enter
   screen, and the variance all line up even if stock moves mid-count. */
export function countItems(parts, category) {
  const items = [];
  for (const p of Object.values(parts || {})) {
    if (!countable(p)) continue;
    const cat = itemCategory(p);
    if (category && category !== "all" && cat !== category) continue;
    items.push({
      id: p.id,
      number: p.number || "",
      description: p.description || "",
      location: p.location || "",
      category: cat,
      cost: num(p.cost),
      expected: num(p.onHand),
    });
  }
  items.sort(
    (a, b) =>
      a.category.localeCompare(b.category) ||
      (a.number || "").localeCompare(b.number || "") ||
      a.description.localeCompare(b.description),
  );
  return items;
}

/* Compare counted amounts to expected. `counts` maps an item id to the counted
   quantity. An item with no entry is treated as NOT COUNTED — it's left out of
   the variance and its stock is not touched. Returns the off lines (counted !=
   expected, biggest dollar swing first) plus the totals the report shows at the
   bottom: how many items are off, the net units, and the money — short
   (shrinkage), over, and net. */
export function countVariance(items, counts) {
  const lines = [];
  let countedItems = 0;
  let netUnits = 0;
  let netValue = 0;
  let shortValue = 0; // value of the shortages, as a positive number
  let overValue = 0; // value of the overages
  for (const it of items || []) {
    const raw = counts ? counts[it.id] : undefined;
    if (raw === undefined || raw === null || raw === "") continue; // not counted
    const counted = num(raw);
    countedItems += 1;
    const diff = counted - it.expected;
    if (diff === 0) continue;
    const diffValue = round2(diff * it.cost);
    netUnits += diff;
    netValue = round2(netValue + diffValue);
    if (diff < 0) shortValue = round2(shortValue - diffValue);
    else overValue = round2(overValue + diffValue);
    lines.push({ ...it, counted, diff, diffValue });
  }
  lines.sort((a, b) => Math.abs(b.diffValue) - Math.abs(a.diffValue) || a.number.localeCompare(b.number));
  return {
    lines,
    offCount: lines.length,
    countedItems,
    totalItems: (items || []).length,
    netUnits,
    absUnits: lines.reduce((a, l) => a + Math.abs(l.diff), 0),
    netValue,
    shortValue,
    overValue,
  };
}

/* Turn the counted amounts into part updates: each counted item's on-hand set
   to what was counted. Takes the live parts map (so other fields are kept) and
   returns the list to save. Uncounted items and deleted parts are skipped. */
export function applyCounts(parts, items, counts) {
  const out = [];
  for (const it of items || []) {
    const raw = counts ? counts[it.id] : undefined;
    if (raw === undefined || raw === null || raw === "") continue;
    const cur = (parts || {})[it.id];
    if (!cur) continue;
    out.push({ ...cur, onHand: num(raw) });
  }
  return out;
}
