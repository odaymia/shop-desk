# Import from Mitchell1 Manager SE

Reads a Manager SE backup (`.bak`, a SQL Server backup) directly, with no
SQL Server installed, and writes a Shop Desk import bundle.

```
python3 export_m1.py /path/to/ShopMgt.bak shop.import.json
```

Then in the desk: Settings → Import from Mitchell1 → choose the file.

Manager SE's special packages (Good/Better/Best menus, oil change menu,
tire packages) come over as canned jobs. Its generic canned-job list is
left out unless you pass `--keep-canned-jobs`.

`bak.py` finds the 8 KB database pages inside the backup, decodes the
system catalog to learn table names and column layouts, and walks each
table's data pages. Backups from SQL Server Express are uncompressed,
which is what makes this possible. It has been run against a 2016–2026
Manager SE database; totals on every posted invoice matched Manager SE's
own figures.

What comes across: customers (with phones, emails, addresses), vehicles,
every ticket with its lines, payments and tax, inventory parts with vendors
and on-hand counts, canned jobs, and staff names. Tickets whose customer
was deleted in Manager SE keep their vehicle and plate. Labor guide text
and parts catalog data are Mitchell's and are not copied.

Never commit a bundle: it holds customer data. `.gitignore` covers
`*.import.json`.
