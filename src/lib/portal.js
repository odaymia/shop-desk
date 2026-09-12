/* What a customer sees in the portal, built from the desk's records.
   Pure — no React, no storage. Prices and internal notes stay out
   except where the shop chose to publish a menu price. */
import { orderTotals, jobLines, lineAmount, laborQtyText, owesBalance } from "./invoice.js";
import { findSpec, oilChangeLines } from "./specs.js";
import { checklistSummary } from "./checklist.js";

const MONTH = 30.4 * 86400000;

/* Service intervals the reminders run on. Per shop, with sane defaults. */
export const DEFAULT_INTERVALS = {
  oil: { label: "Oil change", miles: 5000, months: 6, match: /\boil\b(?!.*(?:cooler|pan|pressure|leak))/i },
  rotation: { label: "Tire rotation", miles: 6000, months: 6, match: /rotat/i },
  brakes: { label: "Brake inspection", miles: 12000, months: 12, match: /brake/i },
  air: { label: "Engine air filter", miles: 15000, months: 12, match: /air filter/i },
  cabin: { label: "Cabin air filter", miles: 15000, months: 12, match: /cabin/i },
};

const uidOf = () => "p" + Math.random().toString(36).slice(2, 8);
const lineText = (l) => [l.job, l.description].filter(Boolean).join(": ");

/* The last invoice that did each service, then when it's due next. */
export function dueServices(orders, vehicle, intervals = DEFAULT_INTERVALS, now = Date.now()) {
  const inv = orders.filter((o) => o.status === "invoiced" && o.vehicleId === vehicle.id).sort((a, b) => (b.invoicedAt || 0) - (a.invoicedAt || 0));
  const out = [];
  for (const [key, rule] of Object.entries(intervals)) {
    const last = inv.find((o) => (o.lines || []).some((l) => l.kind !== "note" && rule.match.test(lineText(l))));
    if (!last) continue;
    const lastMiles = Number(last.mileageOut || last.mileageIn) || 0;
    const dueMiles = lastMiles && rule.miles ? lastMiles + rule.miles : null;
    const dueDate = rule.months ? (last.invoicedAt || 0) + rule.months * MONTH : null;
    const curMiles = Number(vehicle.mileage) || lastMiles;
    const overdue = (dueDate && dueDate < now) || (dueMiles && curMiles >= dueMiles);
    const soon = !overdue && ((dueDate && dueDate - now < MONTH) || (dueMiles && dueMiles - curMiles < 500));
    out.push({ key, label: rule.label, lastDate: last.invoicedAt, lastMiles, dueDate, dueMiles, status: overdue ? "overdue" : soon ? "soon" : "ok" });
  }
  return out.sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0));
}

/* One customer's portal record. */
export function portalPayload({ customer, vehicles, orders, specs, parts, cfg, jobs }) {
  const intervals = cfg.serviceIntervals || DEFAULT_INTERVALS;
  const vehs = vehicles.filter((v) => v.customerId === customer.id && v.active !== false);
  return {
    name: [customer.first, customer.last].filter(Boolean).join(" ") || customer.company || "",
    since: customer.createdAt || null,
    vehicles: vehs.map((v) => {
      const history = orders
        .filter((o) => o.vehicleId === v.id && o.status === "invoiced")
        .sort((a, b) => (b.invoicedAt || 0) - (a.invoicedAt || 0))
        .slice(0, 50)
        .map((o) => {
          const t = orderTotals(o, cfg, customer);
          return {
            number: o.number,
            date: o.invoicedAt,
            miles: Number(o.mileageOut || o.mileageIn) || null,
            total: t.total,
            work: (o.lines || []).filter((l) => l.kind === "labor" || l.kind === "part").map((l) => ({ kind: l.kind, text: l.description, qty: l.kind === "part" ? l.qty : undefined })),
            /* the full receipt, as printed */
            concern: o.concern || "",
            checklist: o.checklist && o.checklist.items ? checklistSummary(o.checklist.items) : [],
            lines: (o.lines || [])
              .filter((l) => l.kind !== "note" || l.description)
              .map((l) => ({
                kind: l.kind,
                job: l.job || "",
                number: l.kind === "part" ? l.number || "" : "",
                text: l.description || "",
                details: l.kind === "labor" ? l.details || "" : "",
                condition: l.kind === "part" ? l.condition || "new" : "",
                qtyText: l.kind === "labor" ? laborQtyText(l) : l.kind === "note" ? "" : String(l.qty),
                each: l.kind === "labor" ? l.rate : l.kind === "note" ? null : l.price,
                amount: l.kind === "note" ? null : l.kind === "discount" ? -lineAmount(l) : lineAmount(l),
              })),
            totals: { parts: t.parts, labor: t.labor, sublet: t.sublet, fees: t.fees, supplies: t.supplies, discounts: t.discounts, taxRate: t.taxRate, tax: t.tax, total: t.total, paid: t.paid, balance: t.balance },
            owed: owesBalance(o, t), // imported history is settled; don't show the customer a phantom balance
            payments: (o.payments || []).map((p) => ({ method: p.method, amount: p.amount, at: p.at })),
          };
        });
      const spec = findSpec(specs, v);
      const oilQuote = spec ? quoteOilChange(spec.spec, parts, cfg) : null;
      return {
        id: v.id,
        name: [v.year, v.make, v.model, v.submodel].filter(Boolean).join(" "),
        plate: v.plate || "",
        vin: v.vin || "",
        mileage: v.mileage || null,
        due: dueServices(orders, v, intervals),
        history,
        oil: spec ? { grade: spec.spec.oilViscosity, quarts: spec.spec.oilCapacityQt, exact: spec.exact } : null,
        oilQuote,
      };
    }),
    updatedAt: Date.now(),
  };
}

/* Out-the-door oil change price for this engine, when the shop has the
   spec and stocks the oil: parts + flat labor + tax, no supplies. */
export function quoteOilChange(spec, parts, cfg) {
  const lines = oilChangeLines(spec, parts, uidOf, cfg);
  if (!lines.length || lines.some((l) => l.kind === "part" && !l.price)) return null;
  const t = orderTotals({ lines, noSupplies: true }, cfg);
  return { total: t.total, subtotal: t.subtotal, tax: t.tax };
}

/* The shop's public card: name, contact, and the price menu (canned jobs
   the shop chose to show, priced at today's rates). */
export function shopPublicPayload(cfg, jobs, parts) {
  const menu = Object.values(jobs || {})
    .filter((j) => j.portal && j.active !== false && !j.deleted)
    .map((j) => {
      const lines = jobLines(j, cfg, parts, uidOf, 1);
      const t = orderTotals({ lines, noSupplies: true }, { ...cfg, taxRate: 0 });
      return { name: j.name, category: j.category || "", price: t.subtotal, per: j.unit || "", details: (j.lines || []).filter((l) => l.kind === "labor" && l.details).map((l) => l.details).join(" ") };
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return {
    name: cfg.shopName,
    phone: cfg.shopPhone || "",
    address: cfg.shopAddress || "",
    email: cfg.shopEmail || "",
    website: cfg.shopWebsite || "",
    logo: cfg.logo || "",
    hours: cfg.hours || "",
    ardNumber: cfg.ardNumber || "",
    invoiceFooter: cfg.invoiceFooter || "",
    menu,
    taxRate: cfg.taxRate,
    updatedAt: Date.now(),
  };
}
