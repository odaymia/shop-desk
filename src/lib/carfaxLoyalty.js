/* CARFAX Shop Loyalty Program customer list. Pure — no React, no storage.

   Separate from the service-history file (carfax.js): this is a comma-
   delimited CSV of CUSTOMERS (email/phone/name + the VIN they had serviced),
   so CARFAX can send them their free VIN-specific report and service
   reminders on the shop's behalf. One row per customer per VIN per service
   date. Sent over SFTP under the same location ID as the service feed.

   Consent matters here: EMAIL_OPT_IN and CELLPHONE_OPT_IN record whether the
   customer agreed to be contacted. We never assume yes — a customer is opted
   in only if their record says so (customer.carfaxEmailOptIn /
   carfaxCellOptIn), otherwise "No". */

export const LOYALTY_FIELDS = [
  "EMAIL", "EMAIL_OPT_IN", "VIN", "OPERATION_TYPE", "OPERATION_SALE_TYPE", "OPERATION_DATE",
  "CELLPHONE", "CELLPHONE_OPT_IN", "FIRST_NAME", "LAST_NAME", "ZIPCODE", "PROVIDER_ID", "LOCATION_ID",
];

const mdy = (ts) => {
  if (!ts) return "";
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
};
const clean = (v) => String(v == null ? "" : v).replace(/["\r\n]+/g, " ").replace(/\s+/g, " ").trim();
const digits10 = (v) => {
  const d = String(v == null ? "" : v).replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
};
const yesNo = (v) => (v ? "Yes" : "No");

/* Rows for the loyalty list. `since` (ms) limits to recent transactions —
   CARFAX takes the archive back no more than 24 months. One row per distinct
   customer + VIN + service date; a customer needs a way to be reached (an
   email or a cell) and a valid 17-character VIN, or CARFAX can't use them. */
export function loyaltyRows(orders, customers, vehicles, cfg, since = 0) {
  const providerId = clean(cfg.carfaxProviderId);
  const locationId = clean(cfg.carfaxLocationId);
  const seen = new Set();
  const rows = [];
  for (const o of Object.values(orders || {})) {
    if (!o || o.status !== "invoiced") continue;
    const at = o.invoicedAt || o.createdAt || 0;
    if (at < since) continue;
    const c = customers[o.customerId];
    const v = vehicles[o.vehicleId];
    if (!c || !v) continue;
    const vin = clean(v.vin).toUpperCase();
    if (vin.length !== 17) continue;
    const email = clean(c.email);
    const cell = digits10(c.phone) || digits10(c.phone2);
    if (!email && !cell) continue; // no way to reach them
    const date = mdy(at);
    const key = `${o.customerId}|${vin}|${date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      EMAIL: email,
      EMAIL_OPT_IN: yesNo(email && c.carfaxEmailOptIn),
      VIN: vin,
      OPERATION_TYPE: "Service",
      OPERATION_SALE_TYPE: "", // blank for service transactions
      OPERATION_DATE: date,
      CELLPHONE: cell,
      CELLPHONE_OPT_IN: yesNo(cell && c.carfaxCellOptIn),
      FIRST_NAME: clean(c.first),
      LAST_NAME: clean(c.last),
      ZIPCODE: clean(c.zip).slice(0, 5),
      PROVIDER_ID: providerId,
      LOCATION_ID: locationId,
    });
  }
  return rows;
}

/* CSV: header line then one comma-delimited, double-quoted row each. */
export function loyaltyFile(rows) {
  const line = (vals) => vals.map((v) => `"${String(v == null ? "" : v).replace(/"/g, "'")}"`).join(",");
  return [line(LOYALTY_FIELDS), ...rows.map((r) => line(LOYALTY_FIELDS.map((f) => r[f])))].join("\n") + "\n";
}

/* CARFAX names these PartnerName_CustomerList_HIST_MMDDYYYY.csv (HIST for the
   one-time back file, PROD for the daily). */
export function loyaltyFileName(partner, type, date) {
  const d = date || new Date();
  const stamp = `${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}${d.getFullYear()}`;
  return `${(partner || "ShopDesk").replace(/\W+/g, "")}_CustomerList_${type === "HIST" ? "HIST" : "PROD"}_${stamp}.csv`;
}
