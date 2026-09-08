/* Valvoline's passenger-car motor oil lines, by viscosity. Used to say
   "for this car, stock one of these." Update when the lineup changes. */

export const VALVOLINE_LINES = [
  { line: "Restore & Protect Full Synthetic", grades: ["0W-20", "5W-20", "5W-30"], note: "Full synthetic, removes deposits" },
  { line: "Extended Protection Full Synthetic", grades: ["0W-16", "0W-20", "5W-20", "5W-30", "10W-30"], note: "Full synthetic, long drain" },
  { line: "Advanced Full Synthetic", grades: ["0W-16", "0W-20", "0W-30", "0W-40", "5W-20", "5W-30", "5W-40", "10W-30"], note: "Full synthetic" },
  { line: "MaxLife High Mileage Synthetic Blend", grades: ["0W-20", "5W-20", "5W-30", "10W-30", "10W-40", "20W-50"], note: "Over 75,000 miles" },
  { line: "MaxLife Full Synthetic High Mileage", grades: ["0W-20", "5W-20", "5W-30", "10W-30"], note: "Over 75,000 miles, full synthetic" },
  { line: "Daily Protection Synthetic Blend", grades: ["5W-20", "5W-30", "10W-30", "10W-40"], note: "Synthetic blend" },
  { line: "Daily Protection Conventional", grades: ["5W-20", "5W-30", "10W-30", "10W-40", "20W-50"], note: "Conventional" },
  { line: "European Vehicle Full Synthetic", grades: ["0W-20", "0W-30", "0W-40", "5W-30", "5W-40"], note: "European approvals (VW, MB, BMW, Porsche)" },
  { line: "Premium Blue (diesel)", grades: ["15W-40", "10W-30", "5W-40"], note: "Heavy-duty diesel" },
];

/* Valvoline products that come in this grade, best fit first. Cars with
   European approvals in the spec get the European line up top. */
export function valvolineFor(viscosity, oilSpec, mileage) {
  const v = String(viscosity || "").toUpperCase().replace(/\s+/g, "");
  if (!v) return [];
  const euro = /\b(VW|MB|BMW|PORSCHE|ACEA|LL-0)/i.test(String(oilSpec || ""));
  const highMiles = Number(mileage) >= 75000;
  return VALVOLINE_LINES.filter((l) => l.grades.includes(v))
    .map((l) => ({ ...l, product: `Valvoline ${l.line} ${v}` }))
    .sort((a, b) => score(b, euro, highMiles) - score(a, euro, highMiles));
}
function score(l, euro, highMiles) {
  let s = 0;
  if (euro && /European/.test(l.line)) s += 10;
  if (highMiles && /MaxLife/.test(l.line)) s += 5;
  if (/Extended|Advanced|Restore/.test(l.line)) s += 2;
  return s;
}
