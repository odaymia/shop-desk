/* Oil-change reminder sticker. Pure — no React, no storage.

   When an oil-change ticket is posted, the shop prints a windshield reminder
   sticker: the vehicle, when/at what mileage the next service is due, and the
   oil that was used. Values are computed here; the layout is in Sticker.jsx. */

/* An oil change is on the ticket when any line is part of a package. */
export function hasOilChange(order) {
  return (((order && order.lines) || []).some((l) => l.packaged));
}

/* The oil that went in: among the package's parts, the one with the most
   quarts (the filter is qty 1), by its description. */
export function lastOilUsed(order) {
  const parts = (((order && order.lines) || []).filter((l) => l.packaged && l.kind === "part"));
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
