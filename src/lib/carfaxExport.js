/* CARFAX Car Care data files.

   Two feeds, both built here from the shop's real tickets:

   1. Service file (Generic Car Care Maintenance) — one pipe-delimited .TXT with
      a header row and one line per completed service event (a multi-service
      repair order becomes several lines). Only INVOICED tickets whose vehicle
      has a valid 17-character VIN are included. HIST = full history at setup;
      PROD = a day's closed tickets.

   2. Customer list (Shop Loyalty Program) — one CSV per completed operation.
      Archive goes back at most 24 months.

   Pure and tested (tests/carfaxExport.test.js). The field ORDER and formatting
   are dictated by CARFAX's specs — don't reorder columns or drop the header.

   Note on opt-in: CARFAX's loyalty file carries email/cell opt-in flags. Until
   the desk captures explicit marketing consent (customer.marketingOptIn), those
   default to "No", which is the safe/honest value. */
import { STATUS } from "./invoice.js";

const cleanVin = (v) => String(v || "").toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
export const validVin = (v) => cleanVin(v).length === 17;

// A field value wrapped in double quotes, with characters that would break the
// pipe or CSV framing removed (embedded quotes, pipes, and newlines).
const q = (v) =>
  `"${String(v ?? "")
    .replace(/["|\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()}"`;

const pad2 = (n) => String(n).padStart(2, "0");
const mdy = (ts) => {
  if (!ts) return "";
  const d = new Date(ts);
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()}`;
};
export const stamp = (ts = Date.now()) => {
  const d = new Date(ts);
  return `${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${d.getFullYear()}`;
};
const digits10 = (p) => String(p || "").replace(/\D/g, "").slice(-10);
const phoneDash = (p) => {
  const d = digits10(p);
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : "";
};

/* CARFAX identifiers + this location's details, from cfg.carfax with sensible
   fallbacks to the shop's own info. */
export function carfaxCfg(cfg) {
  const c = (cfg && cfg.carfax) || {};
  return {
    managementSystem: (c.managementSystem || "BOLT BADGER").toUpperCase(),
    locationId: c.locationId || "",
    providerId: c.providerId || "",
    locationName: c.locationName || (cfg && cfg.shopName) || "",
    address: c.address || "",
    city: c.city || "",
    state: c.state || "",
    zip: c.zip || "",
    phone: (cfg && cfg.shopPhone) || c.phone || "",
    url: (cfg && cfg.shopWebsite) || c.url || "",
  };
}
export const partnerSlug = (cfg) => (carfaxCfg(cfg).managementSystem || "BOLTBADGER").replace(/[^A-Za-z0-9]/g, "");

/* The 24 service-file columns, in the required order. */
export const SERVICE_FIELDS = [
  "VIN", "RO_OPEN_DATE", "RO_CLOSE_DATE", "MILEAGE", "ODOMETER_MEASURE", "RO_INVOICE_NUMBER",
  "SERVICE_DESCRIPTION", "LABOR_DESCRIPTION", "PART_NAME_DESCRIPTION", "PART_QUANTITY",
  "MAKE", "MODEL", "MODEL_YEAR", "PLATE", "PLATE_STATE",
  "MANAGEMENT_SYSTEM", "LOCATION_ID", "LOCATION_NAME", "ADDRESS", "CITY", "STATE", "POSTAL_CODE", "PHONE", "URL",
];

// A performed service line worth reporting (parts, labor, sublet — not fees,
// discounts, or notes) with an actual description.
const performed = (l) => !!l && ["part", "labor", "sublet"].includes(l.kind) && !!String(l.description || "").trim();

/* Service rows from invoiced tickets. One row per performed line. Returns the
   rows plus counts so the UI can say how many were used and how many tickets
   were skipped for a missing/invalid VIN. `sinceTs` limits to that day (PROD). */
export function serviceRows(orders, vehicles, cfg, { sinceTs = 0 } = {}) {
  const cf = carfaxCfg(cfg);
  const rows = [];
  let skippedNoVin = 0;
  let usedOrders = 0;
  const list = Object.values(orders || {})
    .filter((o) => o && o.status === STATUS.invoiced && (o.invoicedAt || o.createdAt || 0) >= sinceTs)
    .sort((a, b) => (a.invoicedAt || a.createdAt || 0) - (b.invoicedAt || b.createdAt || 0));
  for (const o of list) {
    const v = (vehicles || {})[o.vehicleId] || {};
    if (!validVin(v.vin)) {
      skippedNoVin += 1;
      continue;
    }
    const lines = (o.lines || []).filter(performed);
    if (!lines.length) continue;
    usedOrders += 1;
    const open = mdy(o.createdAt || o.invoicedAt);
    const close = mdy(o.invoicedAt || o.createdAt);
    const miles = Math.round(Number(o.mileageOut || o.mileageIn || 0)) || "";
    for (const l of lines) {
      rows.push({
        VIN: cleanVin(v.vin),
        RO_OPEN_DATE: open,
        RO_CLOSE_DATE: close,
        MILEAGE: miles,
        ODOMETER_MEASURE: "MI",
        RO_INVOICE_NUMBER: o.number || "",
        SERVICE_DESCRIPTION: l.description,
        LABOR_DESCRIPTION: l.kind === "labor" ? l.description : "",
        PART_NAME_DESCRIPTION: l.kind === "part" ? l.description : "",
        PART_QUANTITY: l.kind === "part" ? Number(l.qty) || "" : "",
        MAKE: v.make || "",
        MODEL: v.model || "",
        MODEL_YEAR: v.year || "",
        PLATE: v.plate || "",
        PLATE_STATE: v.plateState || "",
        MANAGEMENT_SYSTEM: cf.managementSystem,
        LOCATION_ID: cf.locationId,
        LOCATION_NAME: cf.locationName,
        ADDRESS: cf.address,
        CITY: cf.city,
        STATE: cf.state,
        POSTAL_CODE: cf.zip,
        PHONE: phoneDash(cf.phone),
        URL: cf.url,
      });
    }
  }
  return { rows, skippedNoVin, usedOrders };
}

export function serviceFileText(rows) {
  const line = (cells) => SERVICE_FIELDS.map((f) => q(cells ? cells[f] : f)).join("|");
  return [line(null), ...rows.map((r) => line(r))].join("\r\n") + "\r\n";
}

/* Customer list (Shop Loyalty Program) fields, in order. */
export const LOYALTY_FIELDS = [
  "Email", "Email_Opt_In", "VIN", "Operation_Type", "Operation_Sale_Type", "Operation_Date",
  "CellPhone", "CellPhone_Opt_In", "First_Name", "Last_Name", "ZipCode", "Provider_ID", "Location_ID",
];

const MONTH_MS = 30.44 * 24 * 3600 * 1000;

/* One customer-list row per invoiced service, back at most `monthsBack` months
   (24 for the archive). Only tickets with a valid VIN. */
export function loyaltyRows(orders, customers, vehicles, cfg, { monthsBack = 24, sinceTs = 0, now = Date.now() } = {}) {
  const cf = carfaxCfg(cfg);
  const cutoff = Math.max(sinceTs, now - monthsBack * MONTH_MS);
  const rows = [];
  let skippedNoVin = 0;
  const list = Object.values(orders || {})
    .filter((o) => o && o.status === STATUS.invoiced && (o.invoicedAt || o.createdAt || 0) >= cutoff)
    .sort((a, b) => (a.invoicedAt || a.createdAt || 0) - (b.invoicedAt || b.createdAt || 0));
  for (const o of list) {
    const v = (vehicles || {})[o.vehicleId] || {};
    if (!validVin(v.vin)) {
      skippedNoVin += 1;
      continue;
    }
    const c = (customers || {})[o.customerId] || {};
    const optIn = c.marketingOptIn ? "Yes" : "No";
    rows.push({
      Email: c.email || "",
      Email_Opt_In: c.email ? optIn : "No",
      VIN: cleanVin(v.vin),
      Operation_Type: "Service",
      Operation_Sale_Type: "",
      Operation_Date: mdy(o.invoicedAt || o.createdAt),
      CellPhone: digits10(c.phone),
      CellPhone_Opt_In: c.phone ? optIn : "No",
      First_Name: c.first || "",
      Last_Name: c.last || "",
      ZipCode: c.zip || "",
      Provider_ID: cf.providerId,
      Location_ID: cf.locationId,
    });
  }
  return { rows, skippedNoVin };
}

export function loyaltyFileText(rows) {
  const line = (cells) => LOYALTY_FIELDS.map((f) => q(cells ? cells[f] : f)).join(",");
  return [line(null), ...rows.map((r) => line(r))].join("\r\n") + "\r\n";
}

/* File names per CARFAX's convention:
   service:  PartnerName_PROD_RO_MMDDYYYY.txt   /  PartnerName_HIST_RO_MMDDYYYY.txt
   loyalty:  PartnerName_CustomerList_HIST_MMDDYYYY.csv                              */
export const serviceFileName = (cfg, status, ts = Date.now()) => `${partnerSlug(cfg)}_${status}_RO_${stamp(ts)}.txt`;
export const loyaltyFileName = (cfg, status, ts = Date.now()) => `${partnerSlug(cfg)}_CustomerList_${status}_${stamp(ts)}.csv`;
