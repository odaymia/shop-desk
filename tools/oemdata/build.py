"""Turn a manufacturer research workbook into the data file the desk ships.

    python3 tools/oemdata/build.py "<workbook.xlsx>" src/data/oem/toyota.json --make Toyota

The workbook is the shop's own research from owner's manuals and the
manufacturer's maintenance guides, with these sheets:

  Fluid specs        Year, <make> model, Configuration, Component,
                     Grade or OEM fluid spec, US qt, Volume basis, Status,
                     Page or section, Source URL
  Service intervals  Year, <make> model, Configuration, Service, OEM action,
                     First miles, First months, Repeat miles, Repeat months,
                     Use condition or notes, Status, Page or section, Source URL

Nothing is interpreted here. Every row is kept as written, including the
"not applicable" and "unverified" ones, since a blank is not a zero and a
reference capacity is not a refill amount; src/lib/oemData.js decides what
a row means and whether it applies to a given car. Strings repeat a lot, so
they go in one table and rows hold indexes into it:

  { make, built, strings: [...],
    years: { "2015": { "Camry": {
      f: [[scope, component, spec, qt|null, basis, status, page], ...],
      s: [[scope, service, action, firstMi, firstMo, repeatMi, repeatMo, notes, status, page], ...] } } } }

Source URLs stay in the workbook; the page or section reference is kept.
No third-party packages needed.
"""
import sys, re, json, zipfile, datetime
import xml.etree.ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"

def col_index(ref):
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group(0): n = n * 26 + (ord(ch) - 64)
    return n - 1

def read_xlsx(path):
    """{ sheet name: [row, ...] }, each row a list of strings"""
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    target = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    out = {}
    for s in ET.fromstring(z.read("xl/workbook.xml")).find("m:sheets", NS):
        root = ET.fromstring(z.read("xl/" + target[s.get(REL)].lstrip("/").replace("xl/", "")))
        rows = []
        for r in root.iter("{%s}row" % NS["m"]):
            row = []
            for c in r.findall("m:c", NS):
                i = col_index(c.get("r")) if c.get("r") else len(row)
                while len(row) < i: row.append("")
                t, v = c.get("t"), c.find("m:v", NS)
                if t == "inlineStr": val = "".join(x.text or "" for x in c.iter("{%s}t" % NS["m"]))
                elif t == "s": val = shared[int(v.text)] if v is not None else ""
                else: val = v.text if v is not None and v.text is not None else ""
                row.append(val.strip())
            rows.append(row)
        out[s.get("name")] = rows
    return out

def table(sheets, name):
    rows = sheets.get(name)
    if not rows: sys.exit(f'no sheet named "{name}"')
    head = rows[0]
    return head, [dict(zip(head, r + [""] * (len(head) - len(r)))) for r in rows[1:] if any(r)]

def number(v):
    v = (v or "").strip()
    if not v: return None
    try: f = float(v)
    except ValueError: sys.exit(f"not a number: {v!r}")
    return int(f) if f == int(f) else round(f, 3)

def main():
    argv = sys.argv[1:]
    make = ""
    if "--make" in argv:
        i = argv.index("--make")
        make = argv[i + 1] if i + 1 < len(argv) else ""
        argv = argv[:i] + argv[i + 2:]
    args = [a for a in argv if not a.startswith("--")]
    if len(args) != 2 or not make: sys.exit(__doc__)
    sheets = read_xlsx(args[0])
    fh, fluids = table(sheets, "Fluid specs")
    sh, services = table(sheets, "Service intervals")
    model_col = next((h for h in fh if h.lower().endswith(" model")), None)
    if not model_col: sys.exit("no '<make> model' column in Fluid specs")
    strings, index = [], {}
    def S(v):
        v = (v or "").strip()
        if v not in index:
            index[v] = len(strings); strings.append(v)
        return index[v]
    years = {}
    def slot(r):
        y, m = r["Year"].strip(), r[model_col].strip()
        if not re.fullmatch(r"\d{4}", y) or not m: sys.exit(f"row without a year and model: {r}")
        return years.setdefault(y, {}).setdefault(m, {"f": [], "s": []})
    for r in fluids:
        slot(r)["f"].append([S(r["Configuration"]), S(r["Component"]), S(r["Grade or OEM fluid spec"]), number(r["US qt"]), S(r["Volume basis"]), S(r["Status"]), S(r["Page or section"])])
    for r in services:
        slot(r)["s"].append([S(r["Configuration"]), S(r["Service"]), S(r["OEM action"]), number(r["First miles"]), number(r["First months"]), number(r["Repeat miles"]), number(r["Repeat months"]), S(r["Use condition or notes"]), S(r["Status"]), S(r["Page or section"])])
    data = {"make": make, "built": datetime.date.today().isoformat(), "strings": strings, "years": {y: years[y] for y in sorted(years)}}
    with open(args[1], "w") as f: json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    n_models = sum(len(v) for v in years.values())
    print(f"wrote {args[1]}: {len(fluids)} fluid rows, {len(services)} interval rows, {n_models} year/model entries, years {min(years)}-{max(years)}, {len(strings)} strings")

if __name__ == "__main__":
    main()
