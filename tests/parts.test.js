import { test } from "node:test";
import assert from "node:assert/strict";
import { sellPrice, cartToLines } from "../src/lib/parts.js";

test("sell price marks up cost, respects list, and can end in .99", () => {
  assert.equal(sellPrice(10, 0, { partsMarkupPct: 40 }), 14);
  assert.equal(sellPrice(10, 18.5, { partsMarkupPct: 40 }), 18.5);
  assert.equal(sellPrice(10, 0, { partsMarkupPct: 40, partsPriceEnding99: true }), 13.99);
  assert.equal(sellPrice(10, 0, {}), 13.5);
});

test("a returned cart becomes part lines with the shop's pricing", () => {
  const cart = {
    source: "partstech",
    supplier: "O'Reilly Auto Parts",
    job: "Front brakes",
    items: [
      { partNumber: "103-1354", brand: "BrakeBest", description: "Disc Brake Pads", quantity: 1, cost: 65.06, list: 118.63 },
      { partNumber: "980-1234", description: "Brake Rotor", quantity: 2, cost: 40, list: 0 },
    ],
  };
  let n = 0;
  const lines = cartToLines(cart, { partsMarkupPct: 40 }, () => `L${++n}`);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].number, "103-1354");
  assert.equal(lines[0].description, "BrakeBest Disc Brake Pads");
  assert.equal(lines[0].price, 118.63); // list beats marked-up cost
  assert.equal(lines[0].cost, 65.06);
  assert.equal(lines[0].vendor, "O'Reilly Auto Parts");
  assert.equal(lines[0].condition, "new");
  assert.equal(lines[1].qty, 2);
  assert.equal(lines[1].price, 56);
  assert.equal(lines[1].job, "Front brakes");
});
