/* CARFAX Service History reporting file. Pure — no React, no storage.

   CARFAX takes a nightly pipe-delimited text file from partnered
   management systems, one row per labor or part line on each posted
   invoice, with the invoice and shop details repeated on every row.
   Columns below are CARFAX's, in their order. Sending the file needs a
   Service Data Transfer Facilitation Agreement with CARFAX and their FTP
   credentials; until then the desk can produce the file for a manual
   hand-off. Customer names and prices are never included. */

export const CARFAX_FIELDS = [
  "VIN", "RO_OPEN_DATE", "RO_CLOSE_DATE", "MILEAGE", "ODOMETER_MEASURE", "RO_INVOICE_NUMBER",
  "SERVICE_DESCRIPTION", "LABOR_DESCRIPTION", "PART_NAME_DESCRIPTION", "PART_QUANTITY",
  "MAKE", "MODEL", "MODEL_YEAR", "PLATE", "PLATE_STATE", "MANAGEMENT_SYSTEM",
  "LOCATION_ID", "LOCATION_NAME", "ADDRESS", "CITY", "STATE", "POSTAL_CODE", "PHONE", "URL",
];

const mdy = (ts) => {
  if (!ts) return "";
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
};
const clean = (v) => String(v == null ? "" : v).replace(/[|"\r\n]+/g, " ").replace(/\s+/g, " ").trim();

/* "1234 Main St, San Diego, CA 92101" → parts; anything odd lands in ADDRESS */
export function splitAddress(text) {
  const t = clean(text);
  const m = t.match(/^(.*?),\s*([^,]+?),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?$/i);
  if (!m) return { address: t, city: "", state: "", zip: "" };
  return { address: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), zip: m[4] || "" };
}

/* Rows for one posted invoice. Nothing comes back for a ticket without
   a VIN, since CARFAX files by VIN. */
export function carfaxRows(order, vehicle, cfg) {
  if (!order || order.status !== "invoiced" || !vehicle || !vehicle.vin || String(vehicle.vin).length !== 17) return [];
  const a = splitAddress(cfg.shopAddress);
  const base = {
    VIN: clean(vehicle.vin).toUpperCase(),
    RO_OPEN_DATE: mdy(order.createdAt),
    RO_CLOSE_DATE: mdy(order.invoicedAt || order.createdAt),
    MILEAGE: String(Number(order.mileageOut || order.mileageIn || vehicle.mileage || 0) || ""),
    ODOMETER_MEASURE: "MI",
    RO_INVOICE_NUMBER: String(order.number),
    SERVICE_DESCRIPTION: "",
    LABOR_DESCRIPTION: "",
    PART_NAME_DESCRIPTION: "",
    PART_QUANTITY: "",
    MAKE: clean(vehicle.make),
    MODEL: clean(vehicle.model),
    MODEL_YEAR: String(vehicle.year || ""),
    PLATE: clean(vehicle.plate).toUpperCase(),
    PLATE_STATE: clean(vehicle.plateState).toUpperCase(),
    MANAGEMENT_SYSTEM: "Shop Desk",
    LOCATION_ID: clean(cfg.carfaxLocationId),
    LOCATION_NAME: clean(cfg.shopName),
    ADDRESS: a.address,
    CITY: a.city,
    STATE: a.state,
    POSTAL_CODE: a.zip,
    PHONE: clean(cfg.shopPhone).replace(/\D/g, ""),
    URL: clean(cfg.shopWebsite),
  };
  const rows = [];
  for (const l of order.lines || []) {
    if (l.kind === "labor") {
      rows.push({ ...base, SERVICE_DESCRIPTION: clean(l.job || l.description), LABOR_DESCRIPTION: clean(l.description) });
    } else if (l.kind === "part" || l.kind === "sublet") {
      rows.push({ ...base, SERVICE_DESCRIPTION: clean(l.job || l.description), PART_NAME_DESCRIPTION: clean(l.description), PART_QUANTITY: String(Number(l.qty) || 1) });
    }
  }
  if (!rows.length) rows.push({ ...base, SERVICE_DESCRIPTION: clean(order.concern) || "Service" });
  return rows;
}

/* The whole file: header line then one quoted, pipe-delimited row per line item. */
export function carfaxFile(rows) {
  const line = (vals) => vals.map((v) => `"${String(v == null ? "" : v).replace(/"/g, "'")}"`).join("|");
  return [line(CARFAX_FIELDS), ...rows.map((r) => line(CARFAX_FIELDS.map((f) => r[f])))].join("\n") + "\n";
}

/* CARFAX names files PartnerName_DataStatus_RO_MMDDYYYY.txt: PROD for
   last night's invoices, HIST for a one-time back-file. */
export function carfaxFileName(partner, type, date) {
  const d = date || new Date();
  const mdy = `${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}${d.getFullYear()}`;
  return `${(partner || "ShopDesk").replace(/\W+/g, "")}_${type === "HIST" ? "HIST" : "PROD"}_RO_${mdy}.txt`;
}
