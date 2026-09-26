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
src/desk/ChecklistModal.jsx  the keyboard-driven service checklist and its card on the ticket
src/desk/desk.css          desk stylesheet, including print rules
src/lib/invoice.js         ticket math: lines, tax, supplies, payments — no UI
src/lib/checklist.js       service checklist: defaults, auto-Replaced from ticket lines, cycling — no UI
src/lib/website.js         the shop's public website: content payload, hours, quote — no UI
src/lib/siteRender.js      renders that payload to one self-contained HTML page (pure)
src/site/main.js           /site/?s=<address>: fetches the published payload, writes the page
src/desk/WebsiteSettings.jsx  Settings → Website: fields, live preview, appointment requests
supabase/website.sql       shop_site (public read when published) + site_requests
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

## Shop website

Every shop gets a public site at `site/?s=<web address>`, turned on under
Settings → Website and republished on every settings save. It is built
from the desk's own records (`sitePayload` in `src/lib/website.js`), so
prices and hours never drift from the counter. Rules:

- Only public information goes in the payload: no customers, costs,
  labor rate, API keys. Coupons appear only when ticked on the Website
  page — manager codes like FREE stay private by default.
- The oil change quote must match what a ticket charges
  (`packagePrice` ↔ `oilPackageLines`: extra oil by the tenth of a quart).
- The page is one self-contained HTML document (`renderSite`) so it can be
  downloaded and hosted on the shop's own domain, and so Google reads the
  content. Its small inline script repeats `openStatus`, `packagePrice`
  and `packagesFor`; change them together.
- Everything the shop types is escaped; links must be http(s).
- Each service-menu button gets its own page (`#service-<slug>`, shown with
  CSS `:target` so the single file still works). The words and photos live
  in `src/lib/serviceContent.js`; "how often" comes from the shop's Service
  Review intervals (oil: the reminder-sticker miles/months). Photos are
  Unsplash-licensed, hot-linked, and credited on the page.
- Any coupon can get an ad landing page (`website.offers`, `#offer-<code>` or
  `?offer=<code>`), advertised on the main site or not. Its claim form
  tags the request note with the code so the shop can see which ad worked.
- Email list (desk page "Email list", `src/lib/emailList.js`): customers
  with a valid email plus website signups (`site_signups`), one row per
  address. Unsubscribing sets `customer.emailOptOut` / `unsubscribed_at` and
  keeps the row, so nobody unsubscribed is ever copied or exported again.
  The desk doesn't send mail; the CSV goes to Mailchimp or similar, which
  carries the unsubscribe link CAN-SPAM requires.

## Email (campaigns and automations)

The desk's Email page writes and sends email through Resend, via the
`email` Edge Function (`supabase/functions/email`, tables in
`supabase/email.sql`). One Resend account serves every shop; each shop
sends from its own verified domain (or a shared default sender).

- `src/lib/emailRender.js` draws the email (tables, inline styles; no
  scripts or data: images). Per-person values are placeholders
  (`{first_name}`, `{vehicle}`, `{due_date}`, `{unsubscribe_url}`) that the
  function fills at send time, so one copy serves the whole list.
- `src/lib/emailAutomations.js` decides who's due (thank-you, oil reminder,
  win-back, welcome). Each rule looks only at a short recent window, so
  turning one on never emails years of old customers; every email has a
  `dedupe` key the outbox refuses to repeat. The desk runs it once a day
  (`src/desk/emailRunner.js`) and nudges the function every 15 minutes.
- The function is the only thing that sends. It checks suppressions
  (unsubscribes, bounces) and the shop's daily limit on every batch, signs
  unsubscribe links (HMAC, EMAIL_SECRET), and supports one-click
  unsubscribe headers. The unsubscribe page is `unsubscribe/`.
- Every email carries the shop's address and an unsubscribe link. Never
  remove either.

## Postcards (Marketing → Postcards)

Oil change reminder cards printed and mailed by Lob via the `mail` Edge
Function (`supabase/functions/mail`, tables in `supabase/mail.sql`). The
owner approves each week's batch; nothing mails on its own.

- `src/lib/postcards.js`: who's due (sticker date from a week ago to
  `aheadDays` out, one card per customer), mailable addresses (never the
  shop's own address, which some records carry as a placeholder), and the
  4x6 design. Lob takes at most 10,000 characters of HTML a side, so the
  QR code is drawn as one compact path; keep both sides under the limit.
  The back's lower right is Lob's address and postage area: keep it empty.
- Each reminder is reserved in `mail_keys` before Lob is called, and
  released if Lob refuses the card, so none is mailed twice. Lob calls
  carry an Idempotency-Key.
- `customer.mailOptOut` stops postcards for that customer.

## Known gaps

- No card processing; payments are recorded by hand.
- No parts catalog; PartsTech integration is the plan.
- No labor guide.
- No roles: anyone at the counter PC can see reports and void invoices.
- Two devices creating tickets at the same moment while offline can take the
  same number. The ticket list flags duplicates.
- Everything loads into memory at start. Fine for years of one shop's
  history; page by month before it isn't.
