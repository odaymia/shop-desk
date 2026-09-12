/* Demo mode: a try-it sandbox for prospective shops. Opened with ?demo in
   the URL, it uses its own local database (never the real one), never
   touches the cloud, and loads sample data for a fictional shop so a
   visitor can click around. Nothing they do leaves their browser, and a
   reset button reloads the sample data. */
import { DEFAULT_CFG } from "./config.js";
import { orderTotals } from "./invoice.js";
import { customerKey, vehicleKey, partKey, jobKey, orderKey, specStoreKey, CFG_KEY } from "./keys.js";

export const DEMO_DB = "shopDeskDemo";

export const DEMO = (() => {
  if (typeof window === "undefined") return false;
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.has("demo")) return true;
    if (/(?:^|[?&#])demo\b/.test(window.location.hash)) return true;
    return /\/demo\/?$/.test(window.location.pathname);
  } catch {
    return false;
  }
})();

const DAY = 86400000;

/* The fictional shop and its records. Ids are stable so a reseed is a
   clean rebuild. */
function sampleData() {
  const config = {
    shopName: "Summit Auto Care",
    shopAddress: "482 Foothill Blvd, Denver, CO 80204",
    shopPhone: "3035550142",
    shopEmail: "service@summitautocare.example",
    ardNumber: "DEMO-000000",
    laborRate: 150,
    taxRate: 8,
    hours: "Mon–Fri 7:30–6, Sat 8–2",
    portalEnabled: false,
    authorizationText:
      "I authorize the repair work described on this estimate, along with the necessary parts and materials, at the price shown. No additional work will be done without my approval.\n\nRETURN OF REPLACED PARTS (California): [ ] SAVE my old parts   [ ] Do NOT save my old parts\n\nTEARDOWN: if I do not authorize the repair, the vehicle will be reassembled within ____ days of this estimate.\n\nAn express mechanic's lien is acknowledged on the vehicle to secure the amount of repairs.",
  };

  const customers = [
    { id: "dc1", first: "Maria", last: "Alvarez", phone: "3035550111", email: "maria.alvarez@example.com", city: "Denver", state: "CO" },
    { id: "dc2", first: "James", last: "Okafor", phone: "3035550122", email: "j.okafor@example.com", city: "Denver", state: "CO" },
    { id: "dc3", first: "Priya", last: "Nair", phone: "3035550133", email: "priya.nair@example.com", city: "Lakewood", state: "CO" },
    { id: "dc4", first: "Dylan", last: "Brooks", phone: "3035550144", email: "dylan.b@example.com", city: "Aurora", state: "CO" },
    { id: "dc5", first: "Grace", last: "Sullivan", phone: "3035550155", email: "grace.s@example.com", city: "Denver", state: "CO" },
    { id: "dc6", first: "", last: "", company: "Front Range Plumbing", phone: "3035550166", email: "fleet@frontrangeplumbing.example", city: "Denver", state: "CO" },
  ].map((c) => ({ company: "", street: "", zip: "", phone2: "", notes: "", taxExempt: false, active: true, ...c }));

  const vehicles = [
    { id: "dv1", customerId: "dc1", year: 2019, make: "Toyota", model: "Camry", engine: "2.5L 4-cyl", plate: "COA1234", vin: "4T1B11HK1KU000001", mileage: 61200 },
    { id: "dv2", customerId: "dc2", year: 2021, make: "Honda", model: "Accord", engine: "1.5L Turbo", plate: "COB2345", vin: "1HGCV1F10MA000002", mileage: 38400 },
    { id: "dv3", customerId: "dc3", year: 2017, make: "Subaru", model: "Outback", engine: "2.5L 4-cyl", plate: "COC3456", vin: "4S4BSANC1H3000003", mileage: 88900 },
    { id: "dv4", customerId: "dc4", year: 2015, make: "Ford", model: "F-150", engine: "5.0L V8", plate: "COD4567", vin: "1FTFW1EF0FK000004", mileage: 121500 },
    { id: "dv5", customerId: "dc5", year: 2020, make: "Volkswagen", model: "Golf", engine: "1.4L Turbo (European)", plate: "COE5678", vin: "3VW217AU0LM000005", mileage: 44100 },
    { id: "dv6", customerId: "dc6", year: 2018, make: "Ram", model: "2500", engine: "6.7L Diesel", plate: "COF6789", vin: "3C6UR5DL0JG000006", mileage: 96800 },
    { id: "dv7", customerId: "dc6", year: 2018, make: "Ram", model: "1500", engine: "5.7L V8", plate: "COF6790", vin: "1C6RR7FT0JS000007", mileage: 73100 },
  ].map((v) => ({ submodel: "", plateState: "CO", color: "", notes: "", active: true, ...v }));

  const parts = [
    { id: "dp_oil_conv", number: "VAL-CN-5W30", description: "Valvoline Conventional 5W-30", category: "Oil", oilType: "conventional", packType: "case", packSize: 6, cost: 3.2, price: 6.99, onHand: 44, reorderAt: 24 },
    { id: "dp_oil_syn", number: "VAL-FS-5W30", description: "Valvoline Full Synthetic 5W-30", category: "Oil", oilType: "synthetic", packType: "box", packSize: 5, cost: 4.6, price: 9.99, onHand: 28, reorderAt: 20 },
    { id: "dp_oil_euro", number: "VAL-EU-5W40", description: "Valvoline European Full Synthetic 5W-40", category: "Oil", oilType: "euro", packType: "case", packSize: 6, cost: 6.1, price: 12.99, onHand: 12, reorderAt: 12 },
    { id: "dp_of1", number: "VO106", description: "Engine oil filter", category: "Filters", cost: 2.1, price: 6.99, onHand: 26, reorderAt: 15 },
    { id: "dp_of_can", number: "CH10060", description: "Canister oil filter", category: "Filters", cost: 6.2, price: 13.99, onHand: 6, reorderAt: 6, surcharge: 15, surchargeLabel: "Canister filter charge" },
    { id: "dp_af1", number: "CA10467", description: "Engine air filter", category: "Filters", cost: 6.1, price: 15.99, onHand: 9, reorderAt: 8 },
    { id: "dp_caf1", number: "CF10285", description: "Cabin air filter", category: "Filters", cost: 7.3, price: 18.99, onHand: 7, reorderAt: 8 },
    { id: "dp_pads_f", number: "SCD914", description: "Front brake pads", category: "Brakes", cost: 22, price: 49.99, onHand: 6, reorderAt: 4 },
    { id: "dp_pads_r", number: "SCD1114", description: "Rear brake pads", category: "Brakes", cost: 21, price: 49.99, onHand: 4, reorderAt: 4 },
    { id: "dp_rotor_f", number: "BR900312RGS", description: "Front brake rotor", category: "Brakes", cost: 28, price: 74.99, onHand: 3, reorderAt: 4 },
    { id: "dp_wiper", number: "WB-22", description: "Wiper blade 22\"", category: "Wipers", cost: 6, price: 14.99, onHand: 18, reorderAt: 10 },
  ].map((p) => ({ vendorId: "", location: "", taxable: true, active: true, packType: "", packSize: "", oilType: "", surcharge: "", surchargeLabel: "", ...p }));

  const now = Date.now();
  const mkOil = (oilId, oilPrice) => [
    { id: "l1", kind: "labor", description: "Full service oil change", details: "Up to 5 qt, filter, fluid check.", hours: 1, rate: 24.99, unit: "service", taxable: false, packaged: true, job: "Oil change" },
    { id: "l2", kind: "part", partId: oilId, number: "", description: "Motor oil", qty: 5, price: oilPrice, cost: 0, condition: "new", taxable: true, packaged: true, job: "Oil change" },
    { id: "l3", kind: "part", partId: "dp_of1", number: "VO106", description: "Engine oil filter", qty: 1, price: 6.99, cost: 2.1, condition: "new", taxable: true, packaged: true, job: "Oil change" },
  ];
  const mkBrakes = () => [
    { id: "l1", kind: "part", partId: "dp_pads_f", number: "SCD914", description: "Front brake pads", qty: 1, price: 49.99, cost: 22, condition: "new", taxable: true, job: "Front brake pads replacement" },
    { id: "l2", kind: "labor", description: "Replace front brake pads", hours: 1, rate: 170, taxable: false, job: "Front brake pads replacement" },
  ];

  const orderDefs = [
    ["do1", 2041, "dv1", "dc1", 3, mkOil("dp_oil_conv", 6.99)],
    ["do2", 2042, "dv2", "dc2", 6, mkOil("dp_oil_syn", 9.99)],
    ["do3", 2043, "dv4", "dc4", 9, mkBrakes()],
    ["do4", 2044, "dv3", "dc3", 12, mkOil("dp_oil_conv", 6.99)],
    ["do5", 2045, "dv5", "dc5", 15, mkOil("dp_oil_euro", 12.99)],
    ["do6", 2046, "dv6", "dc6", 18, mkOil("dp_oil_syn", 9.99)],
    ["do7", 2047, "dv1", "dc1", 24, mkBrakes()],
    ["do8", 2048, "dv7", "dc6", 30, mkOil("dp_oil_conv", 6.99)],
    ["do9", 2049, "dv2", "dc2", 40, mkOil("dp_oil_syn", 9.99)],
    ["do10", 2050, "dv3", "dc3", 52, mkOil("dp_oil_conv", 6.99)],
  ];
  const mergedCfg = { ...DEFAULT_CFG, ...config };
  const orders = orderDefs.map(([id, number, vehicleId, customerId, daysAgo, lines]) => {
    const at = now - daysAgo * DAY;
    const base = { id, number, status: "invoiced", customerId, vehicleId, lines, mileageIn: "", mileageOut: "", concern: "", notes: "", createdAt: at, invoicedAt: at, approvedAt: at, updatedAt: at, stockApplied: true, noSupplies: true, history: [{ at, what: "invoiced (demo)" }] };
    const t = orderTotals(base, mergedCfg, null);
    base.payments = [{ id: "p" + id, method: id.charCodeAt(3) % 2 ? "card" : "cash", amount: t.total, ref: "", at }];
    base.paidAt = at;
    return base;
  });
  // one open estimate so the ticket list isn't only invoices
  orders.push({ id: "de1", number: 2051, status: "estimate", customerId: "dc4", vehicleId: "dv4", lines: mkOil("dp_oil_conv", 6.99), mileageIn: 121500, mileageOut: "", concern: "Due for an oil change; check brakes.", notes: "", createdAt: now - DAY, updatedAt: now - DAY, payments: [], history: [{ at: now - DAY, what: "estimate started (demo)" }] });

  const specs = [
    { id: "2019|toyota|camry|2.5l 4-cyl", year: 2019, make: "Toyota", model: "Camry", engine: "2.5L 4-cyl", oilViscosity: "0W-20", oilSpec: "API SP", oilCapacityQt: 4.8, oilFilters: [{ brand: "Valvoline", number: "VO106" }], drainPlugTorque: "30 ft-lb", resetProcedure: "", otherFluids: "", notes: "", source: "demo", active: true },
    { id: "2021|honda|accord|1.5l turbo", year: 2021, make: "Honda", model: "Accord", engine: "1.5L Turbo", oilViscosity: "0W-20", oilSpec: "API SP", oilCapacityQt: 3.7, oilFilters: [{ brand: "Valvoline", number: "VO106" }], drainPlugTorque: "26 ft-lb", resetProcedure: "", otherFluids: "", notes: "", source: "demo", active: true },
  ];

  return { config, customers, vehicles, parts, orders, specs };
}

/* Write the sample data if the demo database is empty. Runs only in demo
   mode, against the demo database. */
export async function seedDemoIfEmpty(sGet, sSet) {
  if (!DEMO) return;
  const existing = await sGet(CFG_KEY, null);
  if (existing && existing.shopName) return;
  const d = sampleData();
  await sSet(CFG_KEY, d.config);
  for (const c of d.customers) await sSet(customerKey(c.id), c);
  for (const v of d.vehicles) await sSet(vehicleKey(v.id), v);
  for (const p of d.parts) await sSet(partKey(p.id), p);
  for (const o of d.orders) await sSet(orderKey(o.id), o);
  for (const s of d.specs) await sSet(specStoreKey(s.id), s);
  // a couple of extra canned jobs beyond the starters
  await sSet(jobKey("demo-coolant"), { id: "demo-coolant", name: "Coolant flush and fill", category: "Radiator services", lines: [{ kind: "part", description: "Coolant", qty: 1, price: 24.99, condition: "new" }, { kind: "labor", description: "Coolant flush", hours: 1, rate: 150 }], active: true });
}

/* Wipe the demo data and reload with a fresh copy. Clears the local
   records (the demo database) and lets seeding run again on reload. */
export async function resetDemo(sList, sDel) {
  for (const prefix of ["sd:", "gac:", "_cloud:"]) {
    const keys = await sList(prefix);
    for (const k of keys) await sDel(k);
  }
  window.location.reload();
}
