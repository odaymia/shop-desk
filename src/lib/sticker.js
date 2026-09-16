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

/* Everything the sticker prints, filled from the ticket, the car, and the
   shop's reminder interval. */
export function stickerData(order, cfg, vehicle) {
  const months = Number(cfg && cfg.reminderMonths) || 3;
  const miles = Number(cfg && cfg.reminderMiles) || 3000;
  const at = (order && (order.invoicedAt || order.createdAt)) || Date.now();
  const d = new Date(at);
  d.setMonth(d.getMonth() + months);
  const cur = Number((order && (order.mileageOut || order.mileageIn)) || (vehicle && vehicle.mileage) || 0);
  const plate = vehicle && vehicle.plate ? String(vehicle.plate).toUpperCase() : "";
  const vname = vehicle ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") : "";
  return {
    vehicleId: plate || vname || (vehicle && vehicle.vin ? String(vehicle.vin).slice(-8).toUpperCase() : ""),
    nextDate: mdy(d),
    nextMileage: cur > 0 ? cur + miles : null,
    lastOil: lastOilUsed(order),
  };
}
