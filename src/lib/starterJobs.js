/* Canned jobs a shop starts with. Any of these the shop doesn't have yet
   (matched by starterKey, or by name for ones seeded before keys existed)
   is added when the desk opens. Fully editable afterwards under Canned
   jobs; retiring one keeps it on file so it isn't added again.

   The tire job is priced per tire: pick the count when adding it and the
   tire, labor, and recycling fee lines all multiply. The tire's own price
   is typed on the ticket or comes from inventory.
   Prices here are locked on the line (a set `price` or `rate` beats the
   inventory price or the shop labor rate), so the job sells for the same
   number until someone changes it. Shop supplies and sales tax still
   apply on top per the shop's settings. */

export const STARTER_JOBS = [
  {
    starterKey: "tires",
    name: "Tires: mount and balance",
    category: "Tires",
    unit: "tire",
    lines: [
      { kind: "part", description: "Tire", number: "", partId: null, qty: 1, price: null, cost: null, perUnit: true },
      { kind: "labor", description: "Mount, balance, and tire disposal", hours: 1, rate: 25, perUnit: true },
      { kind: "fee", description: "CA tire recycling fee", qty: 1, price: 1.75, perUnit: true },
    ],
  },
  {
    starterKey: "front-pads",
    name: "Front brake pads replacement",
    category: "Brakes",
    lines: [
      { kind: "part", description: "Front brake pads", number: "", partId: null, qty: 1, price: 49.99, cost: null },
      { kind: "labor", description: "Replace front brake pads", hours: 1, rate: 170 },
    ],
  },
  {
    starterKey: "rear-pads",
    name: "Rear brake pads replacement",
    category: "Brakes",
    lines: [
      { kind: "part", description: "Rear brake pads", number: "", partId: null, qty: 1, price: 49.99, cost: null },
      { kind: "labor", description: "Replace rear brake pads", hours: 1, rate: 170 },
    ],
  },
];
