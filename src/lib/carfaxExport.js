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

/* Turn a job/service into a clean, accurate description for the Vehicle History
   Report — the job that was done, not the parts. An oil-change package becomes
   "Engine Oil & Filter Change"; a shop's own canned-job name is normalized to
   the common CARFAX wording where it's recognizable, otherwise it's kept as
   written (just tidied). `oil` short-circuits to an oil change when the group
   carries the oil-change flag. */
const titleClean = (s) =>
  String(s || "")
    .replace(/\((?:included|inc\.?)\)/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());

export function carfaxServiceName(label, { oil = false } = {}) {
  const t = String(label || "").toLowerCase();
  if (oil || (/\boil\b/.test(t) && /(change|service|lof|lube)/.test(t))) return "Engine Oil & Filter Change";
  if (/transmission|trans\b|\bcvt\b|\batf\b/.test(t) && /(drain|refill|drain\s*&?\s*fill)/.test(t)) return "Transmission Drain & Refill";
  if (/transmission|trans\b|\bcvt\b|\batf\b/.test(t) && /(flush|exchange|service|fluid)/.test(t)) return "Transmission Flush";
  if (/(coolant|antifreeze|radiator)/.test(t) && /(flush|exchange|service|fluid|drain)/.test(t)) return "Coolant Flush";
  if (/differential|diff\b|gear\s*oil/.test(t)) return "Differential Service";
  if (/transfer\s*case/.test(t)) return "Transfer Case Service";
  if (/power\s*steering/.test(t)) return "Power Steering Fluid Service";
  if (/brake/.test(t) && /fluid/.test(t)) return "Brake Fluid Service";
  if (/brake/.test(t) && /front/.test(t)) return "Front Brake Service";
  if (/brake/.test(t) && /rear/.test(t)) return "Rear Brake Service";
  if (/brake/.test(t)) return "Brake Service";
  if (/cabin/.test(t)) return "Cabin Air Filter Replacement";
  if (/engine\s*air|air\s*filter|air\s*element/.test(t)) return "Engine Air Filter Replacement";
  if (/tire/.test(t) && /rotat/.test(t)) return "Tire Rotation";
  if (/align/.test(t)) return "Wheel Alignment";
  if (/fuel/.test(t) && /filter/.test(t)) return "Fuel Filter Replacement";
  if (/fuel/.test(t) && /(system|inject|clean|induction)/.test(t)) return "Fuel System Cleaning";
  if (/timing\s*belt/.test(t)) return "Timing Belt Replacement";
  if (/serpentine|drive\s*belt/.test(t)) return "Serpentine Belt Replacement";
  if (/spark\s*plug/.test(t)) return "Spark Plug Replacement";
  if (/battery/.test(t)) return "Battery Replacement";
  if (/wiper/.test(t)) return "Wiper Blade Replacement";
  if (/(a\/?c|air\s*condition)/.test(t) && /(recharge|refrig|service|evac)/.test(t)) return "A/C Service";
  if (/coolant|antifreeze/.test(t)) return "Coolant Service";
  if (/multi-?point|inspection|courtesy\s*check/.test(t)) return "Vehicle Inspection";
  return titleClean(label);
}

// One service-file row: the job that was done, no parts (part columns stay null).
function serviceRow(o, v, cf, open, close, miles, desc) {
  return {
    VIN: cleanVin(v.vin),
    RO_OPEN_DATE: open,
    RO_CLOSE_DATE: close,
    MILEAGE: miles,
    ODOMETER_MEASURE: "MI",
    RO_INVOICE_NUMBER: o.number || "",
    SERVICE_DESCRIPTION: desc,
    LABOR_DESCRIPTION: "",
    PART_NAME_DESCRIPTION: "",
    PART_QUANTITY: "",
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
  };
}

// The performed lines of a ticket, one row per JOB done (not per part).
function ticketRows(o, v, cf) {
  const lines = (o.lines || []).filter(performed);
  if (!lines.length) return [];
  const open = mdy(o.createdAt || o.invoicedAt);
  const close = mdy(o.invoicedAt || o.createdAt);
  const miles = Math.round(Number(o.mileageOut || o.mileageIn || 0)) || "";
  // group by job name; loose lines each stand alone
  const groups = new Map();
  for (const l of lines) {
    const job = String(l.job || "").trim();
    const key = job ? `job:${job}` : `line:${l.id || Math.random()}`;
    if (!groups.has(key)) groups.set(key, { job, lines: [] });
    groups.get(key).lines.push(l);
  }
  const rows = [];
  for (const g of groups.values()) {
    const hasLabor = g.lines.some((l) => l.kind === "labor" || l.kind === "sublet");
    if (!g.job && !hasLabor) continue; // loose parts, no job — not a service, skip
    const oil = g.lines.some((l) => l.oil);
    const labor = g.lines.find((l) => l.kind === "labor" || l.kind === "sublet");
    const label = g.job || (labor && labor.description) || g.lines[0].description;
    const desc = carfaxServiceName(label, { oil });
    if (desc) rows.push(serviceRow(o, v, cf, open, close, miles, desc));
  }
  // a ticket of only loose parts still deserves one line so the visit shows
  if (!rows.length) {
    const l0 = lines[0];
    rows.push(serviceRow(o, v, cf, open, close, miles, carfaxServiceName(l0.description, { oil: l0.oil })));
  }
  return rows;
}

/* Service rows from invoiced tickets — ONE row per job/service performed (the
   job that was done, no parts). Returns the rows plus counts so the UI can say
   how many were used and how many tickets were skipped for a missing VIN.

   Options:
   - sinceTs:       only tickets closed on/after this time (a day's PROD file).
   - recentRecords: cap to roughly this many rows, taking the NEWEST whole
                    tickets — a repair order is never split, so the result is at
                    least this many rows (e.g. 250 → the latest tickets that
                    total 250+ services). */
export function serviceRows(orders, vehicles, cfg, { sinceTs = 0, recentRecords = 0 } = {}) {
  const cf = carfaxCfg(cfg);
  let skippedNoVin = 0;
  const groups = []; // { ts, rows }
  const list = Object.values(orders || {}).filter((o) => o && o.status === STATUS.invoiced && (o.invoicedAt || o.createdAt || 0) >= sinceTs);
  for (const o of list) {
    const v = (vehicles || {})[o.vehicleId] || {};
    if (!validVin(v.vin)) {
      skippedNoVin += 1;
      continue;
    }
    const rows = ticketRows(o, v, cf);
    if (rows.length) groups.push({ ts: o.invoicedAt || o.createdAt || 0, rows });
  }

  let chosen = groups;
  if (recentRecords > 0) {
    // newest tickets first, accumulate whole tickets until we hit the target
    const picked = [];
    let count = 0;
    for (const g of [...groups].sort((a, b) => b.ts - a.ts)) {
      picked.push(g);
      count += g.rows.length;
      if (count >= recentRecords) break;
    }
    chosen = picked;
  }
  chosen = chosen.sort((a, b) => a.ts - b.ts); // report chronologically
  return { rows: chosen.flatMap((g) => g.rows), skippedNoVin, usedOrders: chosen.length };
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
