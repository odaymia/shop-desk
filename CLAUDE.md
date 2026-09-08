# Shop Desk

Browser-based front desk for Genie Auto Center, an auto service shop in San
Diego: tickets, customers, vehicles, inventory, invoices, reports. It replaces
Mitchell1 Manager SE. Long term it is the core of a shop operating system
(tires, quick lube, CRM — see ROADMAP.md) sold to other shops. Build
accordingly: nothing hardcoded, everything configurable, multi-shop from the
start.

Sister app: the Shop Time Clock at `../timeclock/files (4)` (repo
odaymia/shop-time-clock). Same Supabase project, same shop account, same
staff list. Different app, different repo, different deploy.

## Stack

Vite + React 18, plain JavaScript. No server.

```
index.html                 Vite entry, boot spinner, error banner
src/main.jsx               mounts the app
src/App.jsx                root: loads settings and staff, Setup or Desk
src/base.css               palette and base rules (shared look with the clock)
src/components/            Setup, CloudSync, Toast
src/desk/                  the front desk pages
src/desk/Desk.jsx          shell and navigation
src/desk/useShop.js        loads every record into memory; saves; status moves
src/desk/OrderEditor.jsx   the ticket screen
src/desk/desk.css          desk stylesheet, including print rules
src/lib/invoice.js         ticket math: lines, tax, supplies, payments — no UI
src/lib/vin.js             VIN decode via NHTSA vPIC
src/lib/config.js          DEFAULT_CFG
src/lib/keys.js            storage key layout
src/storage/index.js       the storage module (sGet/sSet/sDel/sList/sGetAll)
src/storage/indexeddb.js   IndexedDB backend (database "shopDesk")
src/storage/cloud.js       Supabase sync: outbox, pull, realtime, sign-in
supabase/schema.sql        shared schema; identical to the time clock's copy
tests/                     node:test files, `npm test`
```

`src/lib/invoice.js` is pure functions and must stay that way: nothing in
it touches React, the DOM, or storage.

## Storage

Every computer keeps a full local copy (IndexedDB) and reads only from it.
When signed in to a shop, writes are queued and mirrored to Supabase, and
changes from other devices are pulled (realtime plus a 60s poll). One
storage module; everything goes through it. Do not scatter IndexedDB or
Supabase calls through the app.

Key layout — one key per record, all routed to the `kv` table:

```
sd:config                  shop settings
sd:counters                { nextOrder } — the ticket number sequence
sd:customer:<id>
sd:vehicle:<id>            customerId points at the owner
sd:part:<id>               inventory
sd:vendor:<id>
sd:job:<id>                canned job
sd:order:<id>              a ticket, whatever its status
sd:spec:<id>               service specs per year/make/model/engine (oil, filter, torque)
sd:cart:<id>               a parts cart sent back by a catalog punchout; applied to its ticket once
gac:employees              the staff list, SHARED with the time clock
_cloud:*                   this computer only, never synced
```

The cloud layer pulls only `sd:*` plus the shared keys, and only uploads
`sd:*` on first link, so the clock's punches never land here and the
clock's copy of the roster is never overwritten by a stale one from here.

Records are never deleted. Customers, vehicles, parts, vendors, jobs get
`active: false`; a posted invoice can only be voided.

## Ticket rules that must hold

- A ticket keeps one number from estimate to invoice. The customer's
  paperwork has it on it.
- Posting an invoice freezes a copy of the pricing rules (tax rate, supplies,
  taxability) on the order as `order.rules`. Totals for a posted invoice
  come from that snapshot, never from current settings.
- Posting pulls inventory for every line with a `partId`; voiding puts it
  back. `stockApplied` on the order stops it happening twice.
- Tax: parts taxable, labor not, by default (California). Configurable per
  shop and overridable per line.
- Premium pay, overtime and payroll live in the time clock. Nothing here
  knows about pay beyond a tech id on a labor line. The shared staff list
  carries PINs and hourly rates for the clock; never display them here.

## UI

Same dark palette as the clock: asphalt background, amber accent, green for
paid, blue for estimates, red for problems. Built for a monitor and mouse,
so denser than the kiosk, but still readable from arm's length. Tabular
numerals for anything numeric. Plain language: "ticket," "lunch," not
"repair order line item," "meal period."

## Known gaps

- No card processing; payments are recorded by hand.
- No parts catalog; PartsTech integration is the plan.
- No labor guide.
- No roles: anyone at the counter PC can see reports and void invoices.
- Two devices creating tickets at the same moment while offline can take the
  same number. The ticket list flags duplicates.
- Everything loads into memory at start. Fine for years of one shop's
  history; page by month before it isn't.
