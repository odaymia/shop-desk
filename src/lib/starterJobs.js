/* Canned jobs a new shop starts with. Written once, when the shop is
   named on first run, and fully editable afterwards under Canned jobs.
   Prices here are locked on the line (a set `price` or `rate` beats the
   inventory price or the shop labor rate), so the job sells for the same
   number until someone changes it. Shop supplies and sales tax still
   apply on top per the shop's settings. */

export const STARTER_JOBS = [
  {
    name: "Front brake pads replacement",
    category: "Brakes",
    lines: [
      { kind: "part", description: "Front brake pads", number: "", partId: null, qty: 1, price: 49.99, cost: null },
      { kind: "labor", description: "Replace front brake pads", hours: 1, rate: 170 },
    ],
  },
  {
    name: "Rear brake pads replacement",
    category: "Brakes",
    lines: [
      { kind: "part", description: "Rear brake pads", number: "", partId: null, qty: 1, price: 49.99, cost: null },
      { kind: "labor", description: "Replace rear brake pads", hours: 1, rate: 170 },
    ],
  },
];
