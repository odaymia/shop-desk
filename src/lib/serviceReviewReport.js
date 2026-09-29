/* Builds the customer-facing Service Review report — the thing that gets
   printed and handed over, posted in the garage, or opened online. Pure: it
   takes the review rows and turns them into a fully-formatted, serializable
   payload (plain-language explanations, a "recommended today" total, and a
   reassuring "up to date" list) that both the print sheet and the public
   report page render without any extra lookups. */

/* Plain-language "what it is / why it matters" for each service, written for
   the customer, not the tech. Keyed by the interval id. */
export const SERVICE_WHY = {
  oil: "Fresh oil and a new filter keep the engine clean, cool, and protected. It's the single most important routine service.",
  tireRotate: "Moving the tires front-to-back evens out the wear so they last longer and keep their grip.",
  engineAir: "A clean engine air filter lets the engine breathe — better throttle response and fuel economy.",
  cabinAir: "This filters the air you breathe inside the car. A dirty one means weak A/C airflow and stale smells.",
  brakeFluid: "Brake fluid soaks up moisture over time, which lowers braking performance and can damage brake parts. A flush restores it.",
  coolant: "Coolant stops the engine from overheating or freezing and protects against rust inside the cooling system.",
  trans: "Fresh transmission fluid keeps shifting smooth and protects one of the most expensive parts on the car.",
  diff: "Differential fluid lubricates the gears that actually turn your wheels.",
  psFluid: "Clean power-steering fluid keeps the steering light, smooth, and quiet.",
  fuelFilter: "A clean fuel filter protects the fuel system and keeps the engine running smoothly.",
  sparkPlugs: "Worn spark plugs cause misfires, rough idle, hard starts, and wasted fuel.",
  serpentine: "One belt drives the alternator, water pump, and A/C. A cracked belt can leave you stranded — cheap to replace before it breaks.",
  wipers: "Streaky, chattering wipers cut your visibility in rain. Cheap insurance for a storm.",
};

/* Label + tone for each status, so paper and web read the same. */
export const STATUS_META = {
  due: { label: "Due now", tone: "due" },
  soon: { label: "Due soon", tone: "soon" },
  inspect: { label: "We'll inspect", tone: "inspect" },
  done: { label: "Up to date", tone: "done" },
  unknown: { label: "Ask us", tone: "unknown" },
};

const money = (n) => "$" + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
const fmtPhone = (p) => {
  const d = String(p || "").replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") return fmtPhone(d.slice(1));
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(p || "");
};
const withMi = (n) => (Number(n) || 0).toLocaleString("en-US") + " mi";
const fmtDate = (ts) => (ts ? new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

function everyText(r) {
  if (r.basis === "inspect") return "Checked each visit";
  const m = Number(r.miles) || 0;
  const mo = Number(r.months) || 0;
  return [m ? withMi(m) : "", mo ? `${mo} mo` : ""].filter(Boolean).join(" / ") || "—";
}

/* Turn the review rows (already carrying status, part, effPrice…) into the
   customer report payload. `mileage` is the current odometer. */
export function reviewReport({ cfg = {}, vehicle = {}, mileage = 0, rows = [], advisor = "" }) {
  const services = (rows || []).map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    statusLabel: (STATUS_META[r.status] || STATUS_META.unknown).label,
    tone: (STATUS_META[r.status] || STATUS_META.unknown).tone,
    every: everyText(r),
    lastDone: r.lastDone ? `${withMi(r.lastDone.mileage)} · ${fmtDate(r.lastDone.at)}` : "",
    partNumber: r.part && r.part.number ? r.part.number : "",
    price: Number(r.effPrice) || Number(r.price) || 0,
    priceText: (Number(r.effPrice) || Number(r.price) || 0) ? money(Number(r.effPrice) || Number(r.price) || 0) : "",
    why: SERVICE_WHY[r.id] || "",
  }));

  const recommended = services.filter((s) => s.status === "due" || s.status === "soon");
  const inspect = services.filter((s) => s.status === "inspect");
  const upToDate = services.filter((s) => s.status === "done");
  const recommendedTotal = recommended.reduce((t, s) => t + (s.price || 0), 0);

  const web = (cfg.website && cfg.website.domain) || cfg.shopWebsite || "";
  return {
    kind: "review",
    shopName: cfg.shopName || "",
    shopPhone: fmtPhone(cfg.shopPhone || ""),
    shopAddress: cfg.shopAddress || "",
    website: web ? String(web).replace(/^https?:\/\//, "").replace(/\/+$/, "") : "",
    advisor: advisor || "",
    vehicle: [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" "),
    plate: vehicle.plate ? `${vehicle.plate}${vehicle.plateState ? ` (${vehicle.plateState})` : ""}` : "",
    vin: vehicle.vin || "",
    mileage: Number(mileage) || 0,
    mileageText: (Number(mileage) || 0) ? withMi(Number(mileage) || 0) : "",
    date: fmtDate(Date.now()),
    at: Date.now(),
    services,
    recommended,
    inspect,
    upToDate,
    recommendedCount: recommended.length,
    recommendedTotal,
    recommendedTotalText: money(recommendedTotal),
  };
}
