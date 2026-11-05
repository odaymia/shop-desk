import { test } from "node:test";
import assert from "node:assert/strict";
import { tcApiKey, tcScriptSrc, tcTire, tcTireSize, tcTireName, tireFromSelect, tcVehicle, tcCustomer, quoteToLines, quoteFromEvent } from "../src/lib/tireconnect.js";

// A trimmed onTireSelect payload, exactly as TireConnect documents it.
const SELECT = {
  tires: [
    {
      brand_name: "Toyo",
      part_number: "129450",
      model_name: "Celsius",
      size: "215/45R17 91V XL",
      quantity: 1,
      specs: { speed_rating: "V", load_index: 95, size: { part_1: "235", part_2: "45", part_3: "19" } },
      price: 64.81,
      cost: 58.33,
      fet: 0,
    },
  ],
  vehicle: { year: 2022, make: "Acura", model: "ILX", submodel: "Base" },
};

// A trimmed onEcommerceOrderClick payload.
const ORDER_CLICK = {
  location: { location_id: 13259, contact_name: "John Doe", phone: "1111111111", email: "t@t.com" },
  quote: {
    total_price: 902.51,
    subtotal: 788.84,
    total_tax: 102.5492,
    discounts: [{ total_amount: 78.88, name: "Demo Discount" }],
    rebates: [{ total_amount: 50, name: "Demo rebate" }],
    tires: [{ brand_name: "Bridgestone", part_number: "006942", model_name: "Dueler H/P Sport", size: "235/45R19 95H", quantity: 4, price: 150, cost: 110, fet: 1.5, specs: { size: { part_1: "235", part_2: "45", part_3: "19" } } }],
    services: [
      { key: "price_car_mounting", name: "Install + Balance (Standard)", type: "service", tax_group: "labor", price: 100, tax: 13 },
      { key: "valve_stem_tpms", name: "Valve Stem or TPMS Part Kit", type: "service", tax_group: "labor", price: null, tax: null },
      { key: "disposal_fee", name: "Tire Recycling Fee", type: "fee", tax_group: "not_taxable", price: 80, tax: null },
    ],
    vehicle: { year: 2016, make: "Bentley", model: "Continental" },
  },
};

test("tcApiKey pulls the key out of a pasted embed, quoted or not", () => {
  assert.equal(tcApiKey(`<script>TCWidget.init({apikey:'abc123def456',container:'x'})</script>`), "abc123def456");
  assert.equal(tcApiKey(`TCWidget.initSearch({ apikey: 2e749a493e82d9ab8309aa9ef9a5fc4d, container: 'x' })`), "2e749a493e82d9ab8309aa9ef9a5fc4d");
  assert.equal(tcApiKey(""), "");
});

test("tcScriptSrc finds the widget script, else falls back to the default CDN", () => {
  assert.equal(tcScriptSrc(`<script src="https://app.tireconnect.ca/js/widget.js"></script>`), "https://app.tireconnect.ca/js/widget.js");
  assert.equal(tcScriptSrc("no script here"), "https://app.tireconnect.ca/js/widget.js");
});

test("tcTireSize prefers the structured specs.size over the display string", () => {
  assert.equal(tcTireSize(SELECT.tires[0]), "235/45R19");
  assert.equal(tcTireSize({ size: "215/45R17 91V XL" }), "215/45R17");
});

test("tcTireName joins brand and model", () => {
  assert.equal(tcTireName(SELECT.tires[0]), "Toyo Celsius");
  assert.equal(tcTireName({ brand_name: "", model_name: "" }), "Tire");
});

test("tcTire shapes a tire for the quote builder's pickTire", () => {
  const t = tcTire(SELECT.tires[0]);
  assert.equal(t.description, "Toyo Celsius");
  assert.equal(t.number, "129450");
  assert.equal(t.price, 64.81);
  assert.equal(t.cost, 58.33);
  assert.equal(t.loadSpeed, "95V");
  assert.equal(t.quantity, 1);
});

test("tireFromSelect returns the first tire plus the vehicle", () => {
  const r = tireFromSelect(SELECT);
  assert.equal(r.tire.description, "Toyo Celsius");
  assert.equal(r.vehicle.label, "2022 Acura ILX Base");
  assert.equal(tireFromSelect({ tires: [] }), null);
});

test("tcVehicle builds a label and tolerates missing parts", () => {
  assert.equal(tcVehicle({ year: 2016, make: "Bentley", model: "Continental" }).label, "2016 Bentley Continental");
  assert.equal(tcVehicle(null), null);
  assert.equal(tcVehicle({}), null);
});

test("tcCustomer reads contact_name/email/phone from location or customer", () => {
  assert.deepEqual(tcCustomer(ORDER_CLICK), { name: "John Doe", email: "t@t.com", phone: "1111111111" });
  assert.equal(tcCustomer({}), null);
});

test("quoteFromEvent unwraps the quote from each event shape", () => {
  assert.equal(quoteFromEvent(ORDER_CLICK).total_price, 902.51); // onEcommerceOrderClick -> .quote
  assert.equal(quoteFromEvent(ORDER_CLICK.quote).total_price, 902.51); // onEcommerceOrder (bare)
  const lead = { leads: [{ quotes: [{ total_price: 42, tires: [] }] }] };
  assert.equal(quoteFromEvent(lead).total_price, 42);
  assert.equal(quoteFromEvent(null), null);
});

test("quoteToLines maps tires, FET, services, fees and discounts to ticket lines", () => {
  const { lines, totals, vehicle } = quoteToLines(ORDER_CLICK.quote, { id: (() => { let i = 0; return () => `L${++i}`; })() });
  const kinds = lines.map((l) => l.kind);
  // 1 tire part + 1 FET fee + install/balance labor + disposal fee + discount; the null-priced TPMS service is dropped
  assert.deepEqual(kinds, ["part", "fee", "labor", "fee", "discount"]);

  const tire = lines[0];
  assert.equal(tire.description, "Bridgestone Dueler H/P Sport 235/45R19");
  assert.equal(tire.qty, 4);
  assert.equal(tire.price, 150);
  assert.equal(tire.taxable, true);

  const fet = lines[1];
  assert.equal(fet.price, 1.5);
  assert.equal(fet.qty, 4);
  assert.equal(fet.taxable, false);

  const install = lines[2];
  assert.equal(install.kind, "labor");
  assert.equal(install.rate, 100);
  assert.equal(install.taxable, null); // labor taxability left to the shop's rules

  const disposal = lines[3];
  assert.equal(disposal.kind, "fee");
  assert.equal(disposal.price, 80);
  assert.equal(disposal.taxable, false);

  const disc = lines[4];
  assert.equal(disc.kind, "discount");
  assert.equal(disc.price, -78.88);

  assert.equal(totals.total, 902.51);
  assert.equal(vehicle.make, "Bentley");
});

test("quoteToLines drops null/zero-priced services so nothing phantom-charges", () => {
  const { lines } = quoteToLines({ tires: [], services: [{ name: "Free check", type: "service", price: null }, { name: "Also free", type: "service", price: 0 }] });
  assert.equal(lines.length, 0);
});
