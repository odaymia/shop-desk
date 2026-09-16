/* Oil-change reminder sticker. Pure — no React, no storage.

   When an oil-change ticket is posted, the shop prints a windshield reminder
   sticker: the vehicle, when/at what mileage the next service is due, and the
   oil that was used. Values are computed here; the layout is in Sticker.jsx. */

/* An oil change is on the ticket when a line is flagged as oil, or (older
   tickets, before the flag) a packaged line reads like an oil change.
   Other fluid packages (transmission, coolant…) fold the same way but are
   not oil, so they must not trigger the sticker. */
const readsOil = (l) => /oil change|\blof\b|lube, oil/i.test(`${(l && l.job) || ""} ${(l && l.description) || ""}`);
export function hasOilChange(order) {
  return (((order && order.lines) || []).some((l) => l.oil || (l.packaged && readsOil(l))));
}

/* The oil that went in: among the oil lines, the part with the most quarts
   (the filter is qty 1), by its description. Falls back to packaged parts
   that read like oil for tickets made before the oil flag existed. */
export function lastOilUsed(order) {
  const lines = ((order && order.lines) || []).filter((l) => l.kind === "part");
  const flagged = lines.filter((l) => l.oil);
  const parts = flagged.length ? flagged : lines.filter((l) => l.packaged && readsOil(l));
  if (!parts.length) return "";
  const oil = parts.reduce((a, b) => (Number(b.qty) > Number(a.qty) ? b : a));
  return String(oil.description || "")
    .replace(/\s*\(included\)\s*$/i, "")
    .trim();
}

const mdy = (d) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
const posInt = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/* The mileage the ticket knows: what was read out at service, else the
   car's last recorded odometer, else 0 (unknown — ask for it). */
export function currentMileage(order, vehicle) {
  return posInt((order && (order.mileageOut || order.mileageIn)) || (vehicle && vehicle.mileage) || 0);
}

/* The reminder interval to default to: whatever was last set for this
   specific car wins, so its next visit starts from the same numbers;
   otherwise the shop's default, otherwise 3 months / 3,000 miles. */
export function reminderMonthsFor(vehicle, cfg) {
  return posInt(vehicle && vehicle.reminderMonths) || posInt(cfg && cfg.reminderMonths) || 3;
}
export function reminderMilesFor(vehicle, cfg) {
  return posInt(vehicle && vehicle.reminderMiles) || posInt(cfg && cfg.reminderMiles) || 3000;
}

/* Everything the sticker prints, filled from the ticket, the car, and the
   reminder interval. `opts` lets the sticker screen compute live as the
   tech edits the mileage or the months/miles interval; anything omitted
   falls back to the car's or shop's defaults. */
export function stickerData(order, cfg, vehicle, opts = {}) {
  const months = opts.months != null && opts.months !== "" ? posInt(opts.months) : reminderMonthsFor(vehicle, cfg);
  const miles = opts.miles != null && opts.miles !== "" ? posInt(opts.miles) : reminderMilesFor(vehicle, cfg);
  const cur = opts.mileage != null && opts.mileage !== "" ? posInt(opts.mileage) : currentMileage(order, vehicle);
  const at = (order && (order.invoicedAt || order.createdAt)) || Date.now();
  const d = new Date(at);
  d.setMonth(d.getMonth() + months);
  /* the license plate is the vehicle id, shown with its state — "CA - 8ABC123" */
  const plateNum = vehicle && vehicle.plate ? String(vehicle.plate).toUpperCase().trim() : "";
  const state = vehicle && vehicle.plateState ? String(vehicle.plateState).toUpperCase().trim() : "";
  const plate = plateNum ? (state ? `${state} - ${plateNum}` : plateNum) : "";
  const vname = vehicle ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") : "";
  return {
    vehicleId: plate || vname || (vehicle && vehicle.vin ? String(vehicle.vin).slice(-8).toUpperCase() : ""),
    nextDate: mdy(d),
    nextMileage: cur > 0 ? cur + miles : null,
    lastOil: lastOilUsed(order),
    months,
    miles,
    mileage: cur,
  };
}
