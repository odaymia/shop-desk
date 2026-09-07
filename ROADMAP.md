# Shop OS roadmap

The time clock is the first module of a browser-based shop operating system
for independent auto shops, quick lubes, and tire shops. Everything runs in a
browser, keeps a full local copy so it works with no signal, and syncs through
Supabase so every device in the shop sees the same thing. Multi-shop from day
one so it can be sold to other shops.

Every module lives in this one app. One sign-in, one customer list, one
vehicle history. A tire shop that adds an oil bay does not buy a second
program.

## Phase 1 — Front desk (replaces Mitchell1 Manager SE)

What a shop uses Manager SE for every day, in a browser:

- [x] Customers and their vehicles, with service history per vehicle
- [x] Estimates → repair orders → invoices, one number sequence, never deleted
- [x] Parts, labor, sublet, fee, and discount lines; canned jobs that drop in a bundle
- [x] Sales tax with configurable rates; parts taxable, labor not (California default)
- [x] Shop supplies as a percentage with a cap
- [x] Payments: cash, card, check, other; split tenders; balance due
- [x] Parts inventory with on-hand counts; posting an invoice pulls stock
- [x] Vendors
- [x] VIN decode (free NHTSA vPIC service)
- [x] Printable estimate and invoice with shop header and disclaimer
- [x] Sales and tax report by date range
- [ ] Deferred work: recommendations carried to the next visit
- [ ] Customer authorization signature on the estimate (reuse the timecard signature pad)
- [ ] Appointments board
- [x] Import from Manager SE straight from the .bak backup: customers, vehicles, history, payments, inventory, canned jobs (tools/m1import)
- [ ] Parts catalog and ordering through PartsTech (O'Reilly First Call, AutoZone, NAPA, WorldPac)
- [ ] Labor guide: flat-rate table per shop first; MOTOR / third-party labor API later
- [ ] Text and email the invoice to the customer
- [ ] Card processing (Square or Stripe terminal)
- [ ] Roles: front desk vs technician vs owner. Today everything is behind the manager PIN.

## Phase 2 — Tires

- Tire lookup by size, and by vehicle (OE fitment)
- Live on-hand inventory per size with location (rack, row)
- Live distributor stock and cost (ATD, US AutoForce, Tire Rack Wholesale, NTW) through their dealer APIs
- Tire-specific lines: mount, balance, TPMS service, disposal fee, road hazard
- DOT number capture per tire sold (recall traceability)
- Order from distributor inside the ticket

## Phase 3 — Quick lube

- Service intervals by year/make/model/engine: oil spec and capacity, filter part numbers, drain plug torque, reset procedure
- Bay board: cars in the bay, who is on which, timer per car
- Sticker printing with next-service mileage and date
- Oil inventory in bulk (gallons on hand per tank) plus filters and wipers by part
- Upsell checklist per vehicle (cabin filter, wipers, coolant, differential) driven by the interval data

## Phase 4 — CRM

- Service reminders by text and email, driven by mileage and time since last visit
- Declined-work follow-up
- Review requests after the visit
- Customer lifetime value, visit frequency, lost-customer list
- Two-way texting from the ticket

## Cross-cutting

- Tests for `src/lib/payroll.js` and `src/lib/invoice.js` (invoice tests exist; payroll still needs them)
- Move the stylesheet out of `src/Styles.jsx` into plain CSS
- Kiosk-only role for the shop iPad
- Billing and onboarding for other shops
