# Shop Desk

Front desk software for an auto shop, in the browser. Tickets, customers,
vehicles, inventory, invoices, and reports. Built to replace Mitchell1
Manager SE for Genie Auto Center and, later, to be sold to other shops.

Sister app to the [Shop Time Clock](https://github.com/odaymia/shop-time-clock).
They share one Supabase project, one shop account, and one staff list.

## Run it

Requires Node 18+ and npm.

```
npm install
npm run dev        http://localhost:5173
npm test           invoice math tests
npm run build      production build into dist/
```

Copy `.env.example` to `.env` and fill in the Supabase URL and publishable
key from the time clock's `.env`. Without them the desk still runs, local to
one computer, with no sync.

The database schema lives in `supabase/schema.sql` and is the same file the
time clock uses. Run it once per Supabase project.

## First run

1. Name the shop, or sign in with the time clock account so the staff list
   comes across.
2. Front desk settings: address, phone, labor rate, tax rate.
3. Add the parts you stock under Inventory and the services you sell every
   day under Canned jobs.
4. Start a ticket.

See `ROADMAP.md` for what's built and what's next.

## Importing from ISI LubeSoft

LubeSoft writes a nightly transfer file (`itf_<store><date>_1.xml`) for
every day's invoices. Point the converter at the folder holding them:

```
python3 tools/lsimport/export_ls.py /path/to/transfer/folder lubesoft.import.json
```

Then Settings → Import from Mitchell1 → choose the file. The import
matches cars by VIN or plate and people by phone or email, so a car both
systems know ends up as one record with both histories. Each car's oil
capacity and the oil and filter actually used become its service spec.
