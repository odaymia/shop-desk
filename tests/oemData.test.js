import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { hasOemData, parseScope, carTraits, applies, oemListings, pickListing, oemView, oemOilSpec, oemSchedule, oemNotOnCar, serviceIdOf, useOf, oemCoversYear, oemModels, oemEngineOptions, oemAsks } from "../src/lib/oemData.js";
import { mergeMotorIntervals, serviceStatus, serviceReview, schedFromMerge, applySched, storeDecides, DEFAULT_SERVICE_INTERVALS } from "../src/lib/serviceReview.js";

/* A small made-up data file in the shipped shape, so each rule is tested on
   rows written for it. The real file is checked at the end. */
function build(entries) {
  const strings = [];
  const S = (v) => {
    const i = strings.indexOf(v);
    if (i >= 0) return i;
    strings.push(v);
    return strings.length - 1;
  };
  const years = {};
  for (const [year, model, f = [], s = []] of entries) {
    ((years[year] = years[year] || {})[model] = {
      f: f.map(([scope, comp, spec, qt, basis = "Drain/refill reference", status = "Toyota source"]) => [S(scope), S(comp), S(spec), qt, S(basis), S(status), S("p. 1")]),
      s: s.map(([scope, svc, action, fm, fmo, rm, rmo, notes = "Normal.", status = "Toyota source"]) => [S(scope), S(svc), S(action), fm, fmo, rm, rmo, S(notes), S(status), S("p. 2")]),
    });
  }
  return { make: "Toyota", built: "test", strings, years };
}
const OIL = "SAE 0W-20 ILSAC GF-5; SAE 5W-20 temporary only";
const data = build([
  ["2015", "Camry",
    [["2.5L 2AR-FE gas FWD", "Engine oil, filter changed", OIL, 4.6], ["2.5L 2AR-FE gas FWD", "Engine oil, filter unchanged", OIL, 4.2],
     ["3.5L 2GR-FE V6 FWD", "Engine oil, filter changed", OIL, 6.4],
     ["2.5L 2AR-FE gas FWD", "Engine coolant", "Toyota SLLC", 7.7, "Reference"],
     ["2.5L 2AR-FE gas FWD", "Power steering fluid", "Not applicable; electric power steering", null, "No hydraulic reservoir", "Not applicable"],
     ["3.5L 2GR-FE V6 FWD", "Power steering fluid", "Not applicable; electric power steering", null, "No hydraulic reservoir", "Not applicable"]],
    [["2.5L 2AR-FE gas FWD", "Engine oil and filter", "Replace", 10000, 12, 10000, 12, "Normal with recommended oil."],
     ["2.5L 2AR-FE gas FWD", "Engine oil and filter", "Replace", 5000, 6, 5000, 6, "Primarily dirt/dust, car-top carrier/heavy loading."],
     ["2.5L 2AR-FE gas FWD", "Engine coolant", "Replace", 100000, 120, 50000, 60],
     ["2.5L 2AR-FE gas FWD", "Transmission fluid", "Replace", 60000, 72, null, null, "Primarily car-top carrier or heavy loading."],
     ["2.5L 2AR-FE gas FWD", "Transmission fluid", "Inspect", 30000, 36, 30000, 36, "Normal, inspect and check for leakage."],
     ["2.5L 2AR-FE gas FWD", "Brake fluid", "Inspect", 5000, 6, 5000, 6, "Fluid levels inspected; no scheduled flush stated."],
     ["2.5L 2AR-FE gas FWD", "Spark plugs", "Replace", 120000, 144, null, null]]],
  ["2015", "Camry Hybrid", [["2.5L 2AR-FXE hybrid FWD eCVT", "Engine oil, filter changed", OIL, 4.6]], []],
  ["2018", "RAV4",
    [["2.5L 2AR-FE gas", "Engine oil, filter changed", OIL, 4.6, "Drain/refill reference; verify dipstick"],
     ["2.5L 2AR-FE gas AWD only", "Rear differential", "Toyota Genuine Differential Gear Oil LT 75W-85", 0.5, "OEM reference"]],
    [["2.5L 2AR-FE gas", "Engine oil and filter", "Replace", 10000, 12, 10000, 12],
     ["2.5L 2AR-FE gas, AWD only", "Rear differential oil", "Replace", 15000, 18, 15000, 18, "Only if primarily towing."],
     ["2.5L 2AR-FE gas, AWD only", "Rear differential oil", "Inspect", 15000, 18, 15000, 18, "Normal."]]],
  ["2012", "Camry",
    [["2.5L 2AR-FE gas FWD, through May 2012 production", "Engine oil, filter changed", OIL, 4.7],
     ["2.5L 2AR-FE gas FWD, from Jun 2012 production", "Engine oil, filter changed", OIL, 4.6]], []],
  ["2020", "Corolla",
    [["1.8L 2ZR-FAE gas CVT FWD", "Engine oil, filter changed", OIL, 4.4],
     ["1.8L 2ZR-FE gas FWD", "Engine oil, filter changed", OIL, 4.4, "Drain/refill reference", "Unverified"],
     ["6-speed manual", "Manual transmission gear oil", "API GL-4", 1.9, "OEM reference"]], []],
  ["2019", "Prius", [["1.8L 2ZR-FXE HEV FWD", "Engine oil, filter changed", OIL, 4.4]], []],
  ["2019", "Prius Prime", [["1.8L 2ZR-FXE PHEV FWD", "Engine oil, filter changed", OIL, 4.4]], []],
  ["2019", "Prius c", [["1.5L 1NZ-FXE HEV FWD", "Engine oil, filter changed", OIL, 3.9]], []],
]);
const camry = { id: "v1", year: 2015, make: "Toyota", model: "Camry", engine: "2.5L 4-cyl", ls: { aces: "4Cyl 2.5L 152 MFI DOHC 2AR-FE 178hp" } };

test("factory data: only makes there is a file for", () => {
  assert.equal(hasOemData("Toyota"), true);
  assert.equal(hasOemData("toyota "), true);
  assert.equal(hasOemData("Honda"), false);
  assert.equal(hasOemData(""), false);
});

test("parseScope reads what a configuration says, and nothing it doesn't", () => {
  const a = parseScope("2.5L 2AR-FE gas FWD 6AT");
  assert.deepEqual([[...a.disp], [...a.codes], [...a.drive], [...a.trans], a.fuel, a.qualified], [["2.5"], ["2AR-FE"], ["2wd"], ["auto"], "gas", false]);
  const b = parseScope("2.7L 2TR-FE 6AT 2WD/4WD or 5MT 4WD");
  assert.deepEqual([[...b.drive].sort(), [...b.trans].sort()], [["2wd", "awd"], ["auto", "manual"]]); // both: no constraint
  assert.equal(parseScope("2.5L A25A-FXS hybrid e-AWD").fuel, "hybrid");
  assert.deepEqual([...parseScope("2.5L A25A-FXS hybrid e-AWD").drive], ["awd"]);
  assert.equal(parseScope("AWD only").only, true);
  assert.equal(parseScope("3.5L 2GR-FKS 4WD 6MT with factory Tow Package").qualified, true);
  assert.equal(parseScope("2.5L 2AR-FE gas FWD, from Jun 2012 production").qualified, true);
  const all = parseScope("All covered variants");
  assert.equal(all.disp.size + all.codes.size + all.drive.size + all.trans.size, 0);
  // "EV-GAS" in an engine description is not an engine code
  assert.deepEqual([...carTraits({ ls: { aces: "4Cyl 1.8L FULL HYBRID EV-GAS (FHEV) 2ZR-FXE" } }).codes], ["2ZR-FXE"]);
});

test("carTraits: a hybrid says so; a detailed gas engine is gas; otherwise unknown", () => {
  assert.equal(carTraits(camry).hybrid, false);
  assert.equal(carTraits({ model: "Camry", submodel: "Hybrid LE", engine: "2.5L 4-cyl" }).hybrid, true);
  assert.equal(carTraits({ model: "Camry", engine: "2.5L 4-cyl" }).hybrid, null);
  assert.equal(carTraits(camry).disp, "2.5");
  assert.equal(carTraits({ engine: "", oem: { engine: "3.5", drive: "awd", trans: "manual" } }).disp, "3.5");
  assert.equal(carTraits({ oem: { drive: "awd" } }).drive, "awd");
});

test("applies: yes, maybe (and what is open), or no", () => {
  const t = carTraits(camry);
  assert.equal(applies(parseScope("3.5L 2GR-FE V6 FWD"), t).fit, "no"); // wrong engine
  assert.equal(applies(parseScope("2.5L 2AR-FXE hybrid FWD eCVT"), t).fit, "no"); // car is gas
  assert.deepEqual(applies(parseScope("2.5L 2AR-FE gas FWD"), t), { fit: "maybe", open: ["drive"], hard: false });
  assert.equal(applies(parseScope("2.5L 2AR-FE gas"), t).fit, "yes");
  assert.equal(applies(parseScope("All covered variants"), t).fit, "yes");
  const awd = applies(parseScope("AWD only"), t);
  assert.deepEqual([awd.fit, awd.open, awd.hard], ["maybe", ["drive"], true]);
  assert.equal(applies(parseScope("AWD only"), carTraits({ ...camry, oem: { drive: "2wd" } })).fit, "no");
  assert.equal(applies(parseScope("AWD only"), carTraits({ ...camry, oem: { drive: "awd" } })).fit, "yes");
  assert.equal(applies(parseScope("2.5L 2AR-FE gas, with factory towing package"), t).fit, "maybe"); // can't know from here
});

test("which listing: the plain model, its hybrid, or a trim that names another", () => {
  assert.deepEqual(oemListings(data, camry), ["Camry", "Camry Hybrid"]);
  assert.deepEqual(pickListing(data, camry), { names: ["Camry", "Camry Hybrid"], listing: "Camry", sure: true });
  assert.equal(pickListing(data, { year: 2015, model: "Camry", submodel: "Hybrid XLE" }).listing, "Camry Hybrid");
  // nothing says which: shown as the gas car, but not settled
  assert.deepEqual([pickListing(data, { year: 2015, model: "Camry", engine: "2.5L 4-cyl" }).listing, pickListing(data, { year: 2015, model: "Camry", engine: "2.5L 4-cyl" }).sure], ["Camry", false]);
  // a person's choice settles it
  assert.equal(pickListing(data, { year: 2015, model: "Camry", oem: { listing: "Camry Hybrid" } }).sure, true);
  // a Prius is a Prius, not a Prius c or a Prime, even though all are hybrids
  const prius = { year: 2019, model: "Prius", engine: "1.8L 4-cyl", ls: { aces: "4Cyl 1.8L FULL HYBRID EV-GAS (FHEV) 2ZR-FXE" } };
  assert.deepEqual([pickListing(data, prius).listing, pickListing(data, prius).sure], ["Prius", true]);
  assert.equal(pickListing(data, { ...prius, submodel: "Prime Advanced" }).listing, "Prius Prime");
  assert.equal(pickListing(data, { year: 2019, model: "Prius C" }).listing, "Prius c");
  assert.equal(pickListing(data, { year: 2018, model: "Rav4" }).listing, "RAV4");
  assert.deepEqual(oemListings(data, { year: 2009, model: "Camry" }), []); // year not covered
  assert.equal(oemView(data, { year: 2015, model: "Tercel" }), null);
});

test("oil change: filled in only when the manual gives one answer for this car", () => {
  const oil = oemOilSpec(oemView(data, camry));
  assert.deepEqual([oil.grade, oil.qt, oil.spec, oil.basis], ["0W-20", 4.6, "ILSAC GF-5", "Drain/refill reference"]);
  // the V6 gets the V6 number
  assert.equal(oemOilSpec(oemView(data, { ...camry, engine: "3.5L 6-cyl", ls: { aces: "6Cyl 3.5L 2GR-FE" } })).qt, 6.4);
  // can't tell gas from hybrid: nothing is filled in until a person says
  assert.equal(oemOilSpec(oemView(data, { year: 2015, model: "Camry", engine: "2.5L 4-cyl" })), null);
  assert.equal(oemOilSpec(oemView(data, { year: 2015, model: "Camry", engine: "2.5L 4-cyl", oem: { listing: "Camry" } })).qt, 4.6);
  // engine not known and the engines differ: nothing
  assert.equal(oemOilSpec(oemView(data, { year: 2015, model: "Camry", oem: { listing: "Camry" } })), null);
  assert.equal(oemOilSpec(oemView(data, { year: 2015, model: "Camry", oem: { listing: "Camry", engine: "3.5" } })).qt, 6.4);
  // the number changed mid-year and the build date isn't known: nothing
  assert.equal(oemOilSpec(oemView(data, { ...camry, year: 2012 })), null);
  // "FWD" and "CVT" on the only oil row for the engine describe the car; the oil isn't in doubt
  assert.equal(oemOilSpec(oemView(data, { year: 2020, model: "Corolla", engine: "1.8L 4-cyl", ls: { aces: "4Cyl 1.8L 2ZR-FAE" } })).qt, 4.4);
  // a row the research couldn't confirm is never used
  assert.equal(oemOilSpec(oemView(data, { year: 2020, model: "Corolla", engine: "1.8L 4-cyl", ls: { aces: "4Cyl 1.8L 2ZR-FE" } })), null);
});

test("what the card shows: rows that could apply, each with what it hinges on", () => {
  const v = oemView(data, camry);
  assert.deepEqual(v.fluids.map((r) => r.component), ["Engine oil, filter changed", "Engine oil, filter unchanged", "Engine coolant", "Power steering fluid"]); // the V6 rows are gone
  assert.equal(v.fluids.find((r) => r.component === "Engine coolant").basis, "Reference"); // shown as the manual gives it
  assert.equal(v.fluids.find((r) => r.id === "psFluid").na, true);
  const rav = oemView(data, { year: 2018, model: "RAV4", engine: "2.5L 4-cyl", ls: { aces: "4Cyl 2.5L 2AR-FE" } });
  const diff = rav.fluids.find((r) => r.id === "diff");
  assert.deepEqual([diff.fit, diff.open, diff.scope], ["maybe", ["drive"], "2.5L 2AR-FE gas AWD only"]);
  // told the car is front-drive, the differential rows go away
  assert.equal(oemView(data, { year: 2018, model: "RAV4", engine: "2.5L 4-cyl", oem: { listing: "RAV4", drive: "2wd" } }).fluids.some((r) => r.id === "diff"), false);
});

test("serviceIdOf and useOf sort rows the way the desk needs", () => {
  assert.deepEqual(["Engine oil and filter", "Spark plugs", "Brake fluid", "Power steering fluid", "Engine coolant", "Inverter coolant", "Rear differential oil", "Rear electric drive unit fluid", "Transfer case fluid", "Automatic transmission fluid", "Hybrid e-transaxle fluid", "Manual transmission gear oil", "Clutch hydraulic fluid"].map(serviceIdOf),
    ["oil", "sparkPlugs", "brakeFluid", "psFluid", "coolant", "otherCoolant", "diff", "diff", "transfer", "trans", "trans", "trans", "clutch"]);
  assert.equal(useOf("Normal with recommended oil."), "normal");
  assert.equal(useOf("Normal chart. Daily inspection also applies when off-roading in deep sand."), "normal"); // starts as the normal chart
  assert.equal(useOf("Only if primarily towing, using a roof carrier, or carrying heavy loads."), "special");
  assert.equal(useOf("Primarily dirt/dust, car-top carrier/heavy loading, repeated trips under 5 miles."), "special");
  assert.equal(useOf("Intervening 5k/6mo when specified viscosity was not used at previous change."), "special");
  assert.equal(useOf("Initial then repeat."), "normal");
});

test("schedule: replacements only, special use kept apart, inspections left out", () => {
  const s = oemSchedule(oemView(data, camry));
  const by = (id, type) => s.services.find((x) => x.forId === id && x.serviceType === type);
  assert.deepEqual([by("oil", "Replace").miles, by("oil", "Replace").months, by("oil", "Replace").severeMiles, by("oil", "Replace").severeMonths], [10000, 12, 5000, 6]);
  assert.deepEqual([by("coolant", "Replace").miles, by("coolant", "Replace").repeatMiles, by("coolant", "Replace").repeatMonths], [100000, 50000, 60]);
  // transmission: Toyota lists a replacement only for special use, and an inspection otherwise
  assert.deepEqual([by("trans", "Replace").miles, by("trans", "Replace").severeMiles], [0, 60000]);
  // brake fluid is only inspected: no flush is invented, and the inspection isn't listed
  assert.equal(s.services.some((x) => x.forId === "brakeFluid"), false);
  assert.equal(s.services.every((x) => x.serviceType === "Replace"), true);
  assert.deepEqual(s.notOnCar, ["psFluid"]); // electric power steering
  // can't tell which Camry: no schedule is applied
  assert.deepEqual(oemSchedule(oemView(data, { year: 2015, model: "Camry", engine: "2.5L 4-cyl" })).services, []);
  assert.deepEqual(oemNotOnCar(oemView(data, { year: 2015, model: "Camry", engine: "2.5L 4-cyl" })), []);
});

test("schedule: an AWD-only service waits until the car's drive is known", () => {
  const rav = { year: 2018, model: "RAV4", engine: "2.5L 4-cyl", ls: { aces: "4Cyl 2.5L 2AR-FE" } };
  assert.equal(oemSchedule(oemView(data, rav)).services.some((x) => x.forId === "diff"), false);
  assert.equal(oemSchedule(oemView(data, rav)).services.some((x) => x.forId === "oil"), true);
  const awd = oemSchedule(oemView(data, { ...rav, oem: { drive: "awd" } })).services;
  assert.equal(awd.find((x) => x.forId === "diff" && x.serviceType === "Replace").severeMiles, 15000);
  assert.equal(awd.some((x) => x.serviceType !== "Replace"), false);
  assert.equal(oemSchedule(oemView(data, { ...rav, oem: { drive: "2wd" } })).services.some((x) => x.forId === "diff"), false);
});

test("service review: the factory schedule goes to the right service, with its repeat interval", () => {
  const base = DEFAULT_SERVICE_INTERVALS;
  const sch = oemSchedule(oemView(data, camry));
  const applicable = base.filter((x) => !sch.notOnCar.includes(x.id));
  const mm = mergeMotorIntervals(applicable, sch.services, "both", "normal");
  const row = (id) => mm.intervals.find((x) => x.id === id);
  assert.equal(row("psFluid"), undefined);
  assert.deepEqual([row("oil").miles, row("oil").storeMiles, row("oil").source], [10000, 5000, "MOTOR"]);
  assert.deepEqual([row("coolant").miles, row("coolant").repeatMiles, row("coolant").repeatMonths], [100000, 50000, 60]);
  // "Engine coolant Replace" must not land on anything but coolant, and nothing else picks up a coolant number
  assert.equal(row("brakeFluid").source, "store"); // Toyota only inspects it: the shop's interval stands
  assert.equal("motorInspectMiles" in row("brakeFluid"), false); // inspect intervals aren't carried onto the review
  assert.deepEqual([row("trans").source, row("trans").noFactory], ["store", true]); // no normal-use replacement
  // the special-use replacement is carried for show, and doesn't decide what's due
  assert.deepEqual([row("trans").motorSpecialMiles, row("trans").miles, row("trans").motorMiles], [60000, row("trans").storeMiles, 0]);
  assert.equal(row("oil").motorSpecialMiles, 0); // only when there's no normal interval
  assert.equal(row("sparkPlugs").miles, 120000);
  // the shop set special use: the special schedule applies
  const sev = mergeMotorIntervals(applicable, sch.services, "both", "severe").intervals;
  assert.equal(sev.find((x) => x.id === "oil").miles, 5000);
  assert.deepEqual([sev.find((x) => x.id === "trans").miles, sev.find((x) => x.id === "trans").motorSpecialMiles], [60000, 0]); // there it is the interval itself
  // store-only shops ignore it
  assert.equal(mergeMotorIntervals(applicable, sch.services, "store").intervals.find((x) => x.id === "oil").miles, 5000);

  // first at 100,000, then every 50,000
  const now = Date.UTC(2026, 10, 23);
  const coolant = row("coolant");
  assert.equal(serviceStatus(coolant, null, 90000, now), "unknown"); // not yet at the first interval
  assert.equal(serviceStatus(coolant, null, 104000, now), "due");
  const done = { at: now - 400 * 86400000, mileage: 100000 };
  assert.equal(serviceStatus(coolant, done, 130000, now), "done"); // 30,000 since: under the 50,000 repeat
  assert.equal(serviceStatus(coolant, done, 151000, now), "due"); // 51,000 since
  const r = serviceReview([coolant], { o: { id: "o", status: "invoiced", invoicedAt: done.at, mileageOut: 100000, lines: [{ kind: "labor", description: "Coolant flush" }] } }, 130000, null, now)[0];
  assert.equal(r.nextDueMiles, 150000);
  // and it survives the note kept on the vehicle for My Garage
  const note = schedFromMerge(base, mm.intervals);
  assert.deepEqual(note.items.coolant, { miles: 100000, months: 120, repeatMiles: 50000, repeatMonths: 60 });
  assert.deepEqual(note.items.oil, { miles: 10000, months: 12, repeatMiles: 10000, repeatMonths: 12 });
  assert.deepEqual(note.hidden, ["psFluid"]);
  assert.equal(applySched(base, note).find((x) => x.id === "coolant").repeatMiles, 50000);
});

test("the shipped Toyota file: every row reads, and known cars come out right", () => {
  const real = JSON.parse(fs.readFileSync(new URL("../src/data/oem/toyota.json", import.meta.url), "utf8"));
  assert.equal(real.make, "Toyota");
  const n = real.strings.length;
  let fluids = 0;
  let services = 0;
  for (const [year, models] of Object.entries(real.years)) {
    assert.match(year, /^20\d\d$/);
    for (const m of Object.values(models)) {
      for (const r of m.f) {
        fluids++;
        assert.equal(r.length, 7);
        assert.ok([0, 1, 2, 4, 5, 6].every((i) => Number.isInteger(r[i]) && r[i] >= 0 && r[i] < n));
        assert.ok(r[3] === null || (typeof r[3] === "number" && r[3] > 0 && r[3] < 40), `quarts ${r[3]}`);
      }
      for (const r of m.s) {
        services++;
        assert.equal(r.length, 10);
        assert.ok([3, 4, 5, 6].every((i) => r[i] === null || (typeof r[i] === "number" && r[i] > 0)));
      }
    }
  }
  assert.ok(fluids > 4000 && services > 5000);
  const car = (year, model, engine, aces, oem) => ({ year, make: "Toyota", model, engine, ls: aces ? { aces } : undefined, oem });
  assert.deepEqual([oemOilSpec(oemView(real, car(2015, "Camry", "2.5L 4-cyl", "4Cyl 2.5L 152 MFI DOHC 2AR-FE 178hp"))).grade, oemOilSpec(oemView(real, car(2015, "Camry", "2.5L 4-cyl", "4Cyl 2.5L 152 MFI DOHC 2AR-FE 178hp"))).qt], ["0W-20", 4.6]);
  assert.equal(oemOilSpec(oemView(real, car(2015, "Camry", "3.5L 6-cyl", "6Cyl 3.5L MFI DOHC 2GR-FE"))).qt, 6.4);
  const rav = oemSchedule(oemView(real, car(2018, "RAV4", "2.5L 4-cyl", "4Cyl 2.5L MFI DOHC 2AR-FE")));
  assert.equal(rav.services.find((x) => x.forId === "oil" && x.serviceType === "Replace").miles, 10000);
  assert.equal(rav.services.some((x) => x.forId === "diff"), false); // drive not known
  assert.equal(oemView(real, car(2009, "Camry", "2.4L 4-cyl")), null);
});

test("by default the factory schedule is shown beside the shop's, and the shop's decides what's due", () => {
  const base = DEFAULT_SERVICE_INTERVALS;
  const sch = oemSchedule(oemView(data, camry));
  const applicable = base.filter((x) => !sch.notOnCar.includes(x.id));
  const shown = storeDecides(mergeMotorIntervals(applicable, sch.services, "both", "normal"));
  const oil = shown.intervals.find((x) => x.id === "oil");
  assert.deepEqual([oil.miles, oil.months, oil.motorMiles, oil.motorMonths, oil.source], [5000, 6, 10000, 12, "store"]); // 5,000 decides, 10,000 is on show
  const coolant = shown.intervals.find((x) => x.id === "coolant");
  assert.deepEqual([coolant.miles, coolant.repeatMiles, coolant.motorMiles], [60000, 0, 100000]);
  assert.equal(shown.source, "store");
  assert.equal(shown.intervals.some((x) => x.id === "psFluid"), false); // still left off: the car doesn't have it
  // an oil change 6,000 miles ago is due on the shop's 5,000, though the manual says 10,000
  const now = Date.UTC(2026, 10, 23);
  assert.equal(serviceStatus(oil, { at: now - 100 * 86400000, mileage: 50000 }, 56000, now), "due");
  // and nothing about the interval is written to the car for My Garage, only what it lacks
  assert.deepEqual(schedFromMerge(base, shown.intervals), { hidden: ["psFluid"], items: {} });
});

test("adding a car: the model list, then that model's engines and types, only from the research", () => {
  assert.equal(oemCoversYear(data, 2015), true);
  assert.equal(oemCoversYear(data, 2009), false);
  // a hybrid is a type of its model, not a model of its own
  assert.deepEqual(oemModels(data, 2015), ["Camry"]);
  assert.deepEqual(oemModels(data, 2019), ["Prius", "Prius c"]); // the Prime folds into Prius; the Prius c is its own car
  assert.deepEqual(oemModels(data, 2009), []);
  const camry = oemEngineOptions(data, 2015, "camry");
  assert.deepEqual(camry.map((e) => e.label), ["2.5L 4-cyl", "2.5L 4-cyl Hybrid", "3.5L 6-cyl"]);
  assert.deepEqual(camry.map((e) => [e.listing, e.engine, e.code, e.fuel]), [["Camry", "2.5", "2AR-FE", "gas"], ["Camry Hybrid", "2.5", "2AR-FXE", "hybrid"], ["Camry", "3.5", "2GR-FE", "gas"]]);
  assert.deepEqual(oemEngineOptions(data, 2019, "Prius").map((e) => e.label), ["1.8L 4-cyl Hybrid", "1.8L 4-cyl Plug-in Hybrid"]);
  // two engines that read the same are told apart by their code
  assert.deepEqual(oemEngineOptions(data, 2020, "Corolla").map((e) => e.label), ["1.8L 4-cyl (2ZR-FAE)", "1.8L 4-cyl (2ZR-FE)"]);
  assert.deepEqual(oemEngineOptions(data, 2015, "Tercel"), []); // not in the research: typed by hand
  assert.deepEqual(oemEngineOptions(data, 2009, "Camry"), []);
});

test("adding a car: the choice saved with the car settles which rows are its own", () => {
  for (const o of oemEngineOptions(data, 2015, "Camry")) {
    const car = { year: 2015, make: "Toyota", model: "Camry", engine: o.label, oem: { listing: o.listing, engine: o.engine, code: o.code, fuel: o.fuel } };
    const v = oemView(data, car);
    assert.deepEqual([v.listing, v.sure], [o.listing, true]);
    assert.equal(oemOilSpec(v).qt, o.engine === "3.5" ? 6.4 : 4.6);
  }
  // no trim, no engine description: before, this car couldn't be told from the hybrid
  const hybrid = oemEngineOptions(data, 2015, "Camry")[1];
  const v = oemView(data, { year: 2015, make: "Toyota", model: "Camry", engine: hybrid.label, oem: { listing: hybrid.listing, engine: hybrid.engine, code: hybrid.code, fuel: hybrid.fuel } });
  assert.equal(v.traits.hybrid, true);
  assert.equal(v.fluids.every((r) => /FXE|hybrid/i.test(r.scope)), true);
  // the form asks about drive only when a row hinges on it
  const rav = oemEngineOptions(data, 2018, "RAV4")[0];
  const pick = { listing: rav.listing, engine: rav.engine, code: rav.code, fuel: rav.fuel };
  assert.deepEqual(oemAsks(oemView(data, { year: 2018, model: "RAV4", engine: rav.label, oem: pick })), { drive: true, trans: false });
  assert.deepEqual(oemAsks(oemView(data, { year: 2018, model: "RAV4", engine: rav.label, oem: { ...pick, drive: "awd" } })), { drive: false, trans: false });
  assert.deepEqual(oemAsks(oemView(data, { year: 2015, model: "Camry", engine: "2.5L 4-cyl", oem: { listing: "Camry", engine: "2.5", code: "2AR-FE", fuel: "gas" } })), { drive: false, trans: false });
  assert.deepEqual(oemAsks(null), { drive: false, trans: false });
});

test("adding a car: every choice in the shipped Toyota file leads to its own listing", () => {
  const real = JSON.parse(fs.readFileSync(new URL("../src/data/oem/toyota.json", import.meta.url), "utf8"));
  let n = 0;
  for (const year of Object.keys(real.years)) {
    for (const model of oemModels(real, year)) {
      const opts = oemEngineOptions(real, year, model);
      assert.ok(opts.length > 0, `${year} ${model} has no engine choice`);
      assert.equal(new Set(opts.map((o) => o.label)).size, opts.length, `${year} ${model} has two choices that read the same`);
      for (const o of opts) {
        n++;
        const v = oemView(real, { year: Number(year), make: "Toyota", model, engine: o.label, oem: { listing: o.listing, engine: o.engine || undefined, code: o.code || undefined, fuel: o.fuel } });
        assert.ok(v && v.sure && v.listing === o.listing, `${year} ${model} ${o.label}`);
      }
    }
  }
  assert.ok(n > 400);
  assert.deepEqual(oemEngineOptions(real, 2022, "Camry").map((e) => e.label), ["2.5L 4-cyl", "2.5L 4-cyl Hybrid", "3.5L 6-cyl"]);
  assert.deepEqual(oemEngineOptions(real, 2022, "RAV4").map((e) => e.label), ["2.5L 4-cyl", "2.5L 4-cyl Hybrid", "2.5L 4-cyl Plug-in Hybrid"]);
});
