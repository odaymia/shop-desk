"""Turn a full ISI LubeSoft data folder (opt/isi/lubesoft, the raw .dat
tables) into a Shop Desk import bundle, the same JSON export_ls.py makes
from the nightly transfer files.

    python3 export_lsdb.py /path/to/opt/isi/lubesoft out.json [--store 00003]

What comes over
  customers   owners on the vehicle file (name, address, phones, email)
  vehicles    every vehicle on file plus every plate seen on an invoice,
              with VIN, ACES year/make/model/engine and LubeSoft's oil
              capacity; make and year fall back to the VIN when LubeSoft
              has nothing
  orders      every invoice with lines, coupons, tax, mileage, payments,
              tech initials and the service comments; visits older than
              the invoice table (before Aug 2021) come from the vehicle
              history as one-line summaries with the service codes and
              the total LubeSoft recorded
  parts       the item master with cost, price and category
  specs       oil grade, capacity and filter per engine, learned from work done

Ids are deterministic and match export_ls.py, so the desk's existing
LubeSoft tickets are updated in place:
  lsc<phone|name|plate>   customer      lsv<vin|plate>   vehicle
  lso<invoice>            invoice in the current numbering run
  lsoh<yymmdd>-<invoice>  older invoice (numbers were reused after the
                          2025 restart, so old ones carry their date)
  lsp<code>               part

Only this shop's store is exported. The vehicle history also holds
visits recorded at the operator's other stores (00001, 00002); pass
--all-stores to bring those in as summary tickets tagged with the store.
"""
import sys, os, re, json, datetime, collections, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lsdb import Table

def num(v, nd=2):
    try: return round(float(v or 0), nd)
    except (TypeError, ValueError): return 0.0
def ts(d, hh=12, mm=0, ss=0):
    if not d: return None
    try: return int(datetime.datetime(d.year, d.month, d.day, min(int(hh or 12), 23), min(int(mm or 0), 59), min(int(ss or 0), 59)).timestamp() * 1000)
    except (ValueError, OverflowError): return int(datetime.datetime(d.year, d.month, d.day, 12).timestamp() * 1000)
def plate_of(s):
    s = (s or "").strip().upper()
    m = re.match(r"^([A-Z]{2})-(.+)$", s)
    return (m[2].replace(" ", ""), m[1]) if m else (s.replace(" ", ""), "CA")
def engine_of(aces):
    m = re.search(r"(\d+)\s*Cyl.*?(\d+\.\d)L", aces or "", re.I)
    return f"{m[2]}L {m[1]}-cyl" if m else (aces or "")[:40]
def viscosity_of(code, desc):
    for s in (code or "", desc or ""):
        m = re.search(r"(\d{1,2})W-?(\d{2})", s.upper()) or re.search(r"(?:^|[A-Z])(\d{1,2})/(\d{2})\b", s.upper())
        if m: return f"{int(m[1])}W-{m[2]}"
    return ""
def title(s):
    s = (s or "").strip()
    return s.title() if s.isupper() or s.islower() else s
def digits(*parts):
    d = re.sub(r"\D", "", "".join(p or "" for p in parts))
    return d[-10:] if len(d) >= 10 else ""
def slug(s): return re.sub(r"\W", "", (s or ""))
def yymmdd(d): return f"{d.year % 100:02d}{d.month:02d}{d.day:02d}"

# --- VIN fallback for cars LubeSoft no longer has on file
VIN_YEARS = "ABCDEFGHJKLMNPRSTVWXY123456789"
def vin_year(vin):
    if len(vin) != 17 or vin[9] not in VIN_YEARS: return ""
    i = VIN_YEARS.index(vin[9])
    y = 2010 + i if i < 20 else 2001 + (i - 20)  # A=2010..Y=2030, 1=2001..9=2009
    if y >= 2027: y -= 30  # A..Y also mean 1980..2000 for older cars; an impossible future year means the old cycle
    return y
WMI = {
 "1G1": "Chevrolet", "1GC": "Chevrolet", "1GN": "Chevrolet", "1GB": "Chevrolet", "2G1": "Chevrolet", "3G1": "Chevrolet", "3GN": "Chevrolet", "3GC": "Chevrolet", "2GC": "Chevrolet", "KL1": "Chevrolet", "KL7": "Chevrolet", "KL8": "Chevrolet", "2CN": "Chevrolet",
 "1GT": "GMC", "1GK": "GMC", "1GD": "GMC", "2GT": "GMC", "3GT": "GMC", "1GJ": "GMC", "1G6": "Cadillac", "1GY": "Cadillac", "3GY": "Cadillac", "1G4": "Buick", "2G4": "Buick", "3G5": "Buick", "5GA": "Buick", "KL4": "Buick", "1G2": "Pontiac", "2G2": "Pontiac", "1G3": "Oldsmobile", "1G8": "Saturn", "5GZ": "Saturn",
 "1FA": "Ford", "1FT": "Ford", "1FM": "Ford", "1FD": "Ford", "1FB": "Ford", "1FC": "Ford", "2FM": "Ford", "2FA": "Ford", "2FT": "Ford", "3FA": "Ford", "3FE": "Ford", "1ZV": "Ford", "NM0": "Ford", "WF0": "Ford", "MAJ": "Ford", "1LN": "Lincoln", "5LM": "Lincoln", "2LM": "Lincoln", "3LN": "Lincoln", "1ME": "Mercury", "2ME": "Mercury", "4M2": "Mercury",
 "1C3": "Chrysler", "2C3": "Chrysler", "2C4": "Chrysler", "2A4": "Chrysler", "2A8": "Chrysler", "1A4": "Chrysler", "1A8": "Chrysler", "3A4": "Chrysler", "3A8": "Chrysler", "1C4": "Jeep", "3C4": "Jeep", "1J4": "Jeep", "1J8": "Jeep", "1C6": "Ram", "3C6": "Ram", "3C7": "Ram", "1D7": "Dodge", "3D7": "Dodge", "1B3": "Dodge", "1B7": "Dodge", "2B3": "Dodge", "2D4": "Dodge", "1D4": "Dodge", "1D3": "Dodge", "1D8": "Dodge", "2D8": "Dodge", "3D4": "Dodge", "3C3": "Fiat", "ZFA": "Fiat", "ZFB": "Fiat", "1P3": "Plymouth", "2P4": "Plymouth",
 "1HG": "Honda", "2HG": "Honda", "2HK": "Honda", "2HJ": "Honda", "3HG": "Honda", "3CZ": "Honda", "5FN": "Honda", "5FP": "Honda", "5J6": "Honda", "19X": "Honda", "7FA": "Honda", "JHM": "Honda", "JHL": "Honda", "SHH": "Honda", "19U": "Acura", "19V": "Acura", "JH4": "Acura", "2HN": "Acura", "5J8": "Acura", "5FR": "Acura",
 "JTD": "Toyota", "JTE": "Toyota", "JTG": "Toyota", "JTK": "Toyota", "JTL": "Toyota", "JTM": "Toyota", "JTN": "Toyota", "JTB": "Toyota", "4T1": "Toyota", "4T3": "Toyota", "4T4": "Toyota", "5TD": "Toyota", "5TF": "Toyota", "5TB": "Toyota", "5TE": "Toyota", "2T1": "Toyota", "2T3": "Toyota", "1NX": "Toyota", "5YF": "Toyota", "3TM": "Toyota", "3TY": "Toyota", "VNK": "Toyota", "NMT": "Toyota", "SB1": "Toyota", "MR0": "Toyota", "JTH": "Lexus", "JTJ": "Lexus", "2T2": "Lexus", "58A": "Lexus",
 "JN1": "Nissan", "JN8": "Nissan", "JN6": "Nissan", "1N4": "Nissan", "1N6": "Nissan", "3N1": "Nissan", "3N6": "Nissan", "5N1": "Nissan", "4N2": "Nissan", "JNK": "Infiniti", "JNR": "Infiniti", "JNX": "Infiniti", "5N3": "Infiniti",
 "KMH": "Hyundai", "KM8": "Hyundai", "5NP": "Hyundai", "5NM": "Hyundai", "KMT": "Genesis", "KNA": "Kia", "KND": "Kia", "KNM": "Kia", "5XY": "Kia", "5XX": "Kia", "3KP": "Kia", "U5Y": "Kia",
 "WBA": "BMW", "WBS": "BMW", "WBX": "BMW", "WBY": "BMW", "5UX": "BMW", "5UM": "BMW", "4US": "BMW", "3MW": "BMW", "5YM": "BMW", "WMW": "Mini", "WDD": "Mercedes-Benz", "WDC": "Mercedes-Benz", "WDB": "Mercedes-Benz", "WD3": "Mercedes-Benz", "WD4": "Mercedes-Benz", "4JG": "Mercedes-Benz", "W1K": "Mercedes-Benz", "W1N": "Mercedes-Benz", "W1V": "Mercedes-Benz", "55S": "Mercedes-Benz",
 "WAU": "Audi", "WA1": "Audi", "WUA": "Audi", "WVW": "Volkswagen", "WVG": "Volkswagen", "WV1": "Volkswagen", "WV2": "Volkswagen", "3VW": "Volkswagen", "3VV": "Volkswagen", "1VW": "Volkswagen", "1V2": "Volkswagen", "9BW": "Volkswagen", "WP0": "Porsche", "WP1": "Porsche", "YV1": "Volvo", "YV4": "Volvo", "LVY": "Volvo", "YS3": "Saab",
 "JM1": "Mazda", "JM3": "Mazda", "4F2": "Mazda", "4F4": "Mazda", "1YV": "Mazda", "3MZ": "Mazda", "JF1": "Subaru", "JF2": "Subaru", "4S3": "Subaru", "4S4": "Subaru", "JA3": "Mitsubishi", "JA4": "Mitsubishi", "4A3": "Mitsubishi", "4A4": "Mitsubishi", "MMB": "Mitsubishi", "JS1": "Suzuki", "JS2": "Suzuki", "JS3": "Suzuki", "2S3": "Suzuki",
 "SAJ": "Jaguar", "SAL": "Land Rover", "ZFF": "Ferrari", "ZAM": "Maserati", "ZAR": "Alfa Romeo", "5YJ": "Tesla", "7SA": "Tesla", "LRW": "Tesla", "7FC": "Rivian", "1FU": "Freightliner", "3AK": "Freightliner", "1XP": "Peterbilt", "1XK": "Kenworth", "1NK": "Kenworth", "2NK": "Kenworth", "1HT": "International", "4V4": "Volvo",
}
def vin_make(vin): return WMI.get(vin[:3], "") if len(vin) == 17 else ""

# LubeSoft categories -> desk line kinds (same as export_ls.py)
PART_CATS = {"OIL", "OF", "AF", "CAF", "BRK", "WB", "ATF", "GO", "PSF", "RS", "CO", "COF", "ADD", "FIC", "FF", "LGT", "BAT", "PCV", "WBT"}
NOTE_CATS = {"#K"}
INCLUDED_WITH = {"BRK": "BKS", "ATF": "ATS", "GO": "RDS", "PSF": "PSS", "RS": "RAD"}
INCLUDED_QT = 5
PART_CATEGORY = {"OIL": "Oil", "OF": "Filters", "AF": "Filters", "CAF": "Filters", "FF": "Filters", "BF": "Fluids", "ATF": "Fluids", "GO": "Fluids", "PSF": "Fluids", "RS": "Fluids", "ADD": "Fluids", "WB": "Wipers", "LGT": "Bulbs", "BAT": "Batteries"}
SERVICE_NAMES = {  # fallback names for service codes on old visit summaries
    "FS": "Full service oil change", "AF": "Air filter", "CAF": "Cabin air filter", "WB": "Wiper blades", "ATS": "Automatic transmission service",
    "BFS": "Brake fluid service", "2PT": "Two-part service", "LAB": "Labor", "CFS": "Coolant flush service", "OF": "Oil filter", "BEV": "Beverage",
    "PSS": "Power steering service", "RAD": "Radiator service", "LGT": "Light bulb", "RDS": "Rear differential service", "TR": "Tire rotation",
    "ATF": "Automatic transmission fluid", "OSC": "Oil system cleaner", "FIC": "Fuel injection cleaning", "BS1": "Basic service", "MTS": "Manual transmission service",
    "FF": "Fuel filter", "DEF": "Diesel exhaust fluid", "TCS": "Transfer case service", "FDS": "Front differential service", "SOC": "Synthetic oil charge",
}
CARD_NAMES = {"V": "Visa", "M": "Mastercard", "A": "Amex", "D": "Discover"}
CURRENT_ERA_START = datetime.date(2025, 3, 15)   # invoice numbers restarted here; the desk's tickets use the new run
CURRENT_ERA_MAX = 20000                          # the old run was past 37000 when the new one began; anything this high after the restart is the old run

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root"); ap.add_argument("out")
    ap.add_argument("--store", default="00003", help="this shop's LubeSoft store number")
    ap.add_argument("--all-stores", action="store_true", help="also bring in summary visits recorded at other stores")
    ap.add_argument("--since", default="", help="only tickets on or after this date (YYYY-MM-DD); customers and vehicles always come over")
    a = ap.parse_args()
    R = a.root
    since = datetime.date.fromisoformat(a.since) if a.since else datetime.date.min
    T = lambda n: Table(R, n)

    # ---- lookups
    employees = {r["EMPL"]: title(r["NAME"]) for _, r in T("hrf1").records(names={"EMPL", "NAME"}) if r["EMPL"]}
    aces = {r["MKF1_RECNUM"]: r for _, r in T("mkf1aces").records()}
    esm = {}
    for _, r in T("esmymme").records():
        esm.setdefault((r["YEAR"], r["MKCD"], r["MODCD"], r["ENG"]), r); esm.setdefault((r["YEAR"], r["MKCD"], r["MODCD"]), r)
    vehnotes = collections.defaultdict(list)
    for _, r in T("mkf1c").records():
        for i in range(1, 16):
            if r.get(f"COMMENT{i}"): vehnotes[r["REC#"]].append(r[f"COMMENT{i}"].strip())
    items = {r["ID"]: r for _, r in T("ivfm").records() if r["ID"]}
    svc_names = dict(SERVICE_NAMES)
    for r in items.values():
        if r["TYPE"] in ("J", "O") and r["SERVCODE"] and r["SERVCODE"] not in svc_names: svc_names[r["SERVCODE"]] = title(r["DESC"])

    # ---- vehicles + owners from the vehicle file (newest modified first so current contact info wins)
    customers, vehicles = {}, {}
    veh_by_plate = {}   # LubeSoft vehicle id (e.g. CA-9GXF747) -> desk vehicle id
    mk = T("mkf1")
    recs = [(n, r) for n, r in mk.records() if r["ID"].strip()]
    recs.sort(key=lambda x: (x[1]["MOD_DATE"] or datetime.date.min), reverse=True)
    for n, r in recs:
        plate, state = plate_of(r["ID"])
        vin = r["VIN"].strip().upper() if len(r["VIN"].strip()) == 17 else ""
        vkey = "lsv" + slug(vin or plate)
        nm = r["NAME"].strip()
        last, first = (nm.split(";", 1) + [""])[:2] if ";" in nm else (nm, "")
        last, first = title(last.strip(" .")), title(first.strip(" ."))
        phones = [p for p in (digits(r["AREACODE2"], r["PHONE2"]), digits(r["AREACODE1"], r["PHONE1"]), digits(r["AREACODE3"], r["PHONE3"]),
                              digits(r["AREACODE"], r["PHONE"]), digits(r["WORK_AREACODE"], r["WORK_PHONE"])) if p and p != "0000000000"]
        phones = list(dict.fromkeys(phones))
        email = r["EMAIL"].strip().lower()
        email = email if re.match(r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$", email) else ""
        placeholder = not (first or last or phones)
        ckey = "lsc" + (phones[0] if phones else (slug((first + last).lower()) if (first or last) else slug(vin or plate)))
        c = customers.get(ckey) or {"id": ckey, "first": "", "last": "", "company": "", "phone": "", "phone2": "", "email": "", "street": "", "city": "", "state": "CA", "zip": "", "notes": "", "taxExempt": False, "active": True, "ls": {"placeholder": placeholder}}
        street = " ".join(x for x in (title(r["ADDR1"].strip(" .")), title(r["ADDR2"].strip(" ."))) if x)
        for k, v in (("first", first), ("last", last), ("company", title(r["FLEET_ID"]) if r["FLEET_ID"] else ""), ("phone", phones[0] if phones else ""), ("phone2", phones[1] if len(phones) > 1 else ""), ("email", email), ("street", street), ("city", title(r["CITY"])), ("zip", r["ZIP"].strip()[:10])):
            if v and not c[k]: c[k] = v
        if r["STATE"].strip() and c["state"] == "CA": c["state"] = r["STATE"].strip().upper()
        if r["TAXEXEMPT"].strip(): c["taxExempt"] = True
        if not placeholder: c["ls"]["placeholder"] = False
        c["updatedAt"] = max(c.get("updatedAt") or 0, ts(r["MOD_DATE"]) or 0) or None
        customers[ckey] = c

        ac = aces.get(n)
        year = ac["YEAR"] if ac and ac["YEAR"] else r["YEAR"]
        make, model, submodel, eng = "", "", "", ""
        if ac:
            make, model, submodel, eng = title(ac["MAKE"]), ac["MODEL"], ac["SUBMODEL"], ac["ENGINE"]
        else:
            e = esm.get((r["YEAR"], r["MKCD"], r["MODCD"], r["ENG"])) or esm.get((r["YEAR"], r["MKCD"], r["MODCD"]))
            if e: make, model, eng = title(e["MAKE"]), title(e["MODEL"]), e["ENGINE"]
        if not make and vin: make = vin_make(vin)
        if not year and vin: year = vin_year(vin)
        notes = "; ".join(vehnotes.get(n, []) + ([r["COMMENT"].strip()] if r["COMMENT"].strip() else []))
        v = vehicles.get(vkey) or {"id": vkey, "customerId": ckey, "year": year or "", "make": make, "model": model, "submodel": submodel, "engine": engine_of(eng), "vin": vin, "plate": plate, "plateState": state, "color": "", "mileage": r["EST_MILEAGE"] or "", "notes": notes, "active": True, "createdAt": None, "updatedAt": ts(r["MOD_DATE"]), "ls": {"oilQuarts": r["OIL_QTY"] or 0, "oilType": r["OIL_TYPE"], "aces": eng, "vehid": r["ID"], "rec": n}}
        for k, val in (("year", year), ("make", make), ("model", model), ("submodel", submodel), ("engine", engine_of(eng)), ("vin", vin), ("notes", notes)):
            if val and not v[k]: v[k] = val
        if not customers[v["customerId"]]["ls"]["placeholder"] is False and not placeholder: v["customerId"] = ckey
        vehicles[vkey] = v
        veh_by_plate[r["ID"].strip()] = vkey

    def vehicle_for(vehid, vin=""):
        """a desk vehicle for a LubeSoft vehicle id, made up from the plate if the car is gone from the vehicle file"""
        vid = veh_by_plate.get(vehid)
        if vid: 
            if vin and not vehicles[vid]["vin"]: vehicles[vid]["vin"] = vin
            return vid
        plate, state = plate_of(vehid)
        vkey = "lsv" + slug(vin or plate)
        if vkey not in vehicles:
            ckey = "lsc" + slug(vin or plate)
            customers.setdefault(ckey, {"id": ckey, "first": "", "last": "", "company": "", "phone": "", "phone2": "", "email": "", "street": "", "city": "", "state": "CA", "zip": "", "notes": "", "taxExempt": False, "active": True, "ls": {"placeholder": True}})
            vehicles[vkey] = {"id": vkey, "customerId": ckey, "year": vin_year(vin) or "", "make": vin_make(vin), "model": "", "submodel": "", "engine": "", "vin": vin, "plate": plate, "plateState": state, "color": "", "mileage": "", "notes": "", "active": True, "createdAt": None, "updatedAt": None, "ls": {"oilQuarts": 0, "vehid": vehid, "fromInvoice": True}}
        veh_by_plate[vehid] = vkey
        return vkey

    # ---- parts from the item master
    parts = {}
    for code, r in items.items():
        cat = r["CAT"]
        if cat not in PART_CATS or cat in ("CO", "COF"): continue
        parts["lsp" + slug(code)] = {"id": "lsp" + slug(code), "number": code, "description": title(r["DESC"]), "category": PART_CATEGORY.get(cat, "Parts"), "vendorId": "", "cost": num(r["AGREE_COST"]), "price": num(r["PRICE"]), "onHand": 0, "reorderAt": int(r["REORDER"] or 0), "location": "", "taxable": r["TAXABLE"] != "N", "active": r["STATUS"] != "D", "ls": {"code": code, "category": cat, "unit": r["SLS_UNIT"], "oilType": r["OIL_TYPE"]}}

    # ---- invoice lines, coupons, comments, checklist by invoice record
    lines_by = collections.defaultdict(list)
    for _, r in T("inf1a").records(): lines_by[r["REC#"]].append(r)
    coupons_by = collections.defaultdict(list)
    for _, r in T("inf1d").records(): coupons_by[r["REC#"]].append(r)
    comments_by = collections.defaultdict(list)     # (vehid, invoice, date) -> comment lines
    for _, r in T("inf1svc").records():
        txt = [r[f"COMMENT{i}"].strip() for i in range(1, 8) if r[f"COMMENT{i}"].strip()]
        if txt: comments_by[(r["VEHID"], r["IVC_NUM"], r["SVC_DATE"])].extend(txt)
    checks_by = collections.defaultdict(list)
    for _, r in T("inf1chk").records(names={"REC#", "LINE", "DESCRIPTION", "RESPONSE", "USER_ENTRY1", "USER_ENTRY2"}):
        resp = r["RESPONSE"].strip()
        if resp and resp.upper() not in ("CHECKED OK", "OK", "LEVEL OK", "FULL", "SENSOR OK", "N/A", "NOT CHECKED", "NOT APPLICABLE", "REPLACED"):
            checks_by[r["REC#"]].append((r["LINE"] or 0, re.sub(r"^\d+\.\s*", "", r["DESCRIPTION"].strip()).title(), resp))

    # ---- the vehicle history's service codes, for invoices whose lines LubeSoft no longer holds
    hist_codes = {}
    for _, r in T("mkf1a").records(names={"DATE", "INVOICE", "KEY", "SCA", "SCB", "SCC", "SCD", "SCE", "SCF", "SCG", "SCH", "SCI", "SCJ", "SCK", "SCL"}):
        if r["DATE"]: hist_codes[(r["INVOICE"] or 0, r["DATE"], r["KEY"][:13].strip())] = [r[k].strip() for k in ("SCA", "SCB", "SCC", "SCD", "SCE", "SCF", "SCG", "SCH", "SCI", "SCJ", "SCK", "SCL") if r[k].strip()]

    # ---- invoices
    inf1 = T("inf1")
    orders, specs, seen = {}, {}, {}
    stats = collections.Counter()
    real = []
    for n, r in inf1.records():
        if not (r["DATE"] and r["INVOICE"] and r["VEHID"].strip()): stats["skipped_open_or_placeholder"] += 1; continue
        if r["PROCESSED"] in ("D", "V"): stats["skipped_deleted_or_void"] += 1; continue
        tr = r["TRANNUMBER"] or 0
        if r["PROCESSED"] == "R" and tr > 10**12:   # a reprint: the original date and number ride in the transaction number
            try: date = datetime.date(2000 + tr // 10**12, (tr // 10**10) % 100, (tr // 10**8) % 100)
            except ValueError: stats["skipped_bad_reprint"] += 1; continue
            invoice = tr % 10**8
        else:
            date, invoice = r["DATE"], r["INVOICE"]
        real.append((date, invoice, r["PROCESSED"] == "R", n, r))
    real.sort(key=lambda x: (x[0], x[1], x[2], x[3]))   # originals before reprints
    for date, invoice, reprint, n, r in real:
        key = (date, invoice, r["VEHID"].strip())
        if key in seen: stats["skipped_duplicate"] += 1; continue
        if date < since: continue
        seen[key] = n
        vehid = r["VEHID"].strip()
        vin = r["EXPLODED_VIN"].strip().upper() if len(r["EXPLODED_VIN"].strip()) == 17 else ""
        vkey = vehicle_for(vehid, vin); v = vehicles[vkey]; ckey = v["customerId"]
        mileage = int(r["MILES"] or 0) or None
        if mileage and mileage > int(v["mileage"] or 0): v["mileage"] = mileage
        when = ts(date, r["RINGOUT_HH"] or r["ENDHH"] or r["STARTHH"], r["RINGOUT_MM"] or r["ENDMM"] or r["STARTMM"], r["RINGOUT_SS"] or 0)
        started = ts(r["WO_START_DATE"] or date, r["WO_START_HH"] or r["STARTHH"], r["WO_START_MM"] or r["STARTMM"], r["WO_START_SS"] or 0)
        if not started or started > when: started = when
        v["createdAt"] = min(v["createdAt"] or started, started); v["updatedAt"] = max(v["updatedAt"] or 0, when)
        c = customers[ckey]; c["createdAt"] = min(c.get("createdAt") or started, started); c["updatedAt"] = max(c.get("updatedAt") or 0, when)

        details = sorted(lines_by.get(n, []), key=lambda l: l["LINE#"] or 0)
        has_pkg = any(l["CAT"] == "FS" for l in details)
        cats_here = {l["CAT"] for l in details} | {l["SERVCODE"] for l in details}
        job = "Full service oil change" if has_pkg else ""
        lines, oil_used, filter_used = [], None, None
        era_current = date >= CURRENT_ERA_START and invoice < CURRENT_ERA_MAX
        oid = f"lso{invoice}" if era_current else f"lsoh{yymmdd(date)}-{invoice}"
        k = 1
        while oid in orders: oid = (f"lso{invoice}" if era_current else f"lsoh{yymmdd(date)}-{invoice}") + f"-{k}"; k += 1; stats["fleet_split_or_reused_number"] += 1
        lid_base = oid[3:]
        ln = 0
        for dt in details:
            ln += 1
            code, desc, cat = dt["ITEM"].strip(), dt["DESC"].strip().lstrip("!"), dt["CAT"].strip()
            qty, price, cost = num(dt["QTY"]), num(dt["PRICE"]), num(dt["COST"])
            lid = f"lsl{lid_base}_{ln}"
            if cat in NOTE_CATS or dt["TYPE"] == "K":
                lines.append({"id": lid, "kind": "note", "description": title(desc), "job": job, "taxable": None}); continue
            if price < 0:
                lines.append({"id": lid, "kind": "discount", "description": title(desc), "qty": 1, "price": round(abs(price) * (qty or 1), 2), "taxable": True, "job": job}); continue
            charge = dt["TYPE"] == "O" and cat not in ("CO", "COF", "OIL", "OF")   # an "other" charge (fluid charge, special filter charge), not a part
            if (cat in PART_CATS and not charge) or dt["TYPE"] in ("P", "L"):
                pid = "lsp" + slug(code)
                stock = bool(code) and cat not in ("CO", "COF") and dt["TYPE"] != "O"
                if stock:
                    p = parts.get(pid) or {"id": pid, "number": code, "description": title(desc), "category": PART_CATEGORY.get(cat, "Parts"), "vendorId": "", "cost": cost, "price": price, "onHand": 0, "reorderAt": 0, "location": "", "taxable": True, "active": True, "ls": {"code": code, "category": cat}}
                    if price: p["price"] = price
                    if cost and not p["cost"]: p["cost"] = cost
                    parts[pid] = p
                    if cat == "OIL": oil_used = (code, desc)
                    if cat == "OF": filter_used = (code, desc)
                base = {"kind": "part", "number": code, "partId": pid if stock else None, "description": title(desc), "cost": cost, "condition": "new", "taxable": None, "job": job}
                if has_pkg and cat == "OIL":
                    inc = min(qty, INCLUDED_QT)
                    lines.append({**base, "id": lid, "qty": inc, "price": 0, "description": title(desc) + " (included)"})
                    if qty > INCLUDED_QT:
                        lines.append({**base, "id": lid + "x", "qty": round(qty - INCLUDED_QT, 1), "price": price, "description": f"Extra oil over {INCLUDED_QT} qt — " + title(desc)})
                elif has_pkg and cat == "OF":
                    lines.append({**base, "id": lid, "qty": qty or 1, "price": 0, "description": title(desc) + " (included)"})
                elif cat in INCLUDED_WITH and INCLUDED_WITH[cat] in cats_here:
                    lines.append({**base, "id": lid, "qty": qty or 1, "price": 0, "description": title(desc) + " (included)"})
                else:
                    lines.append({**base, "id": lid, "qty": qty or 1, "price": price})
            elif cat == "FS":
                lines.append({"id": lid, "kind": "labor", "description": title(desc), "details": "Includes up to 5 quarts of oil, oil filter, fluid inspection and top-off.", "hours": qty or 1, "rate": price, "unit": "service", "techId": None, "taxable": True, "job": job})
            else:
                lines.append({"id": lid, "kind": "labor", "description": title(desc), "details": "", "hours": qty or 1, "rate": price, "unit": "service", "techId": None, "taxable": False, "job": job})
        for cp in coupons_by.get(n, []):
            amt = num(cp["AMOUNT"])
            if amt:
                label = ("Coupon " if cp["TYPE"] == "C" else "Discount ") + cp["ID"].strip()
                lines.append({"id": f"lsl{lid_base}_{'c' if cp['TYPE'] == 'C' else 'd'}{cp['ENTRY#'] or 0}", "kind": "discount", "description": label.strip(), "qty": 1, "price": amt, "taxable": True, "job": job})
        for fld in ("COUP", "COUP1", "COUP2", "DISC"):
            amt = num(r[fld])
            if amt: lines.append({"id": f"lsl{lid_base}_{fld.lower()}", "kind": "discount", "description": "Coupon" if fld.startswith("COUP") else "Discount", "qty": 1, "price": amt, "taxable": True, "job": job})
        tax = round(sum(num(r[f"TAX{i}"]) for i in range(1, 6)), 2)
        total = num(r["TICKET_TOTAL"])
        summary_lines = False
        if not details:   # a reprint whose detail lines are gone: one line per service code from the vehicle history
            summary_lines = True
            net0 = round((total or (num(r["GROSS"]) + tax)) - tax + sum(l["price"] for l in lines if l["kind"] == "discount"), 2)
            for i, code in enumerate(hist_codes.get((invoice, date, vehid), []) or ["FS"]):
                lines.insert(i, {"id": f"lsl{lid_base}_s{i+1}", "kind": "labor", "description": svc_names.get(code, code), "details": "", "hours": 1, "rate": net0 if i == 0 else 0, "unit": "service", "techId": None, "taxable": False, "job": ""})
            stats["lines_from_history_codes"] += 1
        if not total: total = round(num(r["GROSS"]) - sum(l["price"] for l in lines if l["kind"] == "discount") + tax, 2)
        net = round(total - tax, 2)
        sub = round(sum((l["hours"] * l["rate"]) if l["kind"] == "labor" else (-l["price"] if l["kind"] == "discount" else l["qty"] * l["price"]) for l in lines if l["kind"] != "note"), 2)
        diff = round(net - sub, 2)
        if abs(diff) > 0.011:
            lines.append({"id": f"lsl{lid_base}_adj", "kind": "fee" if diff > 0 else "discount", "description": "Package pricing adjustment (LubeSoft)", "qty": 1, "price": abs(diff), "taxable": False, "job": job}); stats["adjusted"] += 1
        # payments: the tenders LubeSoft recorded
        pays = []
        others = round(num(r["CRCARD"]) + num(r["CHECK"]) + num(r["CHARGE"]) + num(r["GIFTCERT"]), 2)
        if num(r["CASH"]) > 0:   # CASH is the amount handed over; change is not always recorded
            cash = round(min(num(r["CASH"]), total - others), 2) if total > 0 else num(r["CASH"])
            if cash > 0: pays.append({"method": "cash", "amount": cash, "ref": ""})
        if num(r["CRCARD"]) > 0: pays.append({"method": "card", "amount": num(r["CRCARD"]), "ref": " ".join(x for x in (CARD_NAMES.get(r["CRCODE"].strip(), r["CRCODE"].strip()), r["CRCARDAPRVL"].strip()) if x)})
        if num(r["CHECK"]) > 0: pays.append({"method": "check", "amount": num(r["CHECK"]), "ref": r["CHKNUM"].strip().lstrip("0")})
        if num(r["CHARGE"]) > 0: pays.append({"method": "other", "amount": num(r["CHARGE"]), "ref": ("Fleet charge " + r["FLEET_ID"].strip()).strip()})
        if num(r["GIFTCERT"]) > 0: pays.append({"method": "other", "amount": num(r["GIFTCERT"]), "ref": "Gift certificate"})
        if total > 0 and abs(sum(p["amount"] for p in pays) - total) > 0.011:
            pays = [{"method": pays[0]["method"] if pays else "cash", "amount": total, "ref": pays[0]["ref"] if pays else ""}]; stats["payment_normalized"] += 1
        for i, p in enumerate(pays): p["id"] = f"lspay{lid_base}" + (f"_{i}" if i else ""); p["at"] = when
        notes = list(dict.fromkeys(comments_by.get((vehid, invoice, date), [])))
        checks = sorted(checks_by.get(n, []))
        if checks: notes.append("Inspection: " + "; ".join(f"{d} {resp}" for _, d, resp in checks))
        techs = [r[f"EMPL{i}"].strip() for i in (1, 2, 3, 5, 6, 7) if r[f"EMPL{i}"].strip()]
        orders[oid] = {
            "id": oid, "number": invoice, "status": "invoiced", "customerId": ckey, "vehicleId": vkey,
            "mileageIn": mileage or "", "mileageOut": "", "concern": "", "notes": " ".join(notes),
            "writerId": None, "techId": None, "lines": lines, "recommendations": [], "stockApplied": True, "noSupplies": True,
            "payments": pays if total > 0 else [],
            "createdAt": started, "updatedAt": when, "invoicedAt": when, "approvedAt": started,
            "rules": {"taxRate": 7.75, "partsTaxable": True, "laborTaxable": False, "subletTaxable": False, "suppliesPct": 0, "suppliesCap": 0, "suppliesTaxable": False, "taxExempt": False},
            "taxOverride": tax,
            "history": [{"at": when, "what": "imported from ISI LubeSoft database"}],
            "ls": {"invoice": invoice, "tran": tr, "store": a.store, "net": net, "tax": tax, "total": total, "employee": techs[0] if techs else "", "employeeName": employees.get(techs[0], "") if techs else "", "techs": list(dict.fromkeys(techs)), "workOrder": r["WO#"] or None, "reprint": reprint, "summaryLines": summary_lines, "rec": n, "po": r["PO"].strip(), "fleet": r["FLEET_ID"].strip()},
        }
        stats["invoices"] += 1
        if reprint: stats["from_reprint_only"] += 1
        if v["make"] and v["engine"] and v["ls"].get("oilQuarts"):
            skey = f"{v['year']}|{v['make']}|{v['model']}|{v['engine']}".lower()
            sp = specs.get(skey) or {"year": v["year"], "make": v["make"], "model": v["model"], "engine": v["engine"], "oilViscosity": "", "oilSpec": "", "oilCapacityQt": v["ls"]["oilQuarts"], "oilFilters": [], "drainPlugTorque": "", "resetProcedure": "", "otherFluids": "", "notes": "", "source": "lubesoft", "active": True}
            if oil_used and not sp["oilViscosity"]: sp["oilViscosity"] = viscosity_of(*oil_used)
            if filter_used and not any(f["number"] == filter_used[0] for f in sp["oilFilters"]): sp["oilFilters"].append({"brand": "Valvoline", "number": filter_used[0]})
            specs[skey] = sp

    # ---- older visits from the vehicle history (one summary ticket each)
    covered = {(inv, d, veh) for (d, inv, veh) in seen}
    for _, r in T("mkf1a").records():
        store = r["STORE#"].strip()
        if store != a.store and not a.all_stores: continue
        d, inv, plate13 = r["DATE"], r["INVOICE"] or 0, r["KEY"][:13].strip()
        if not d or not plate13: stats["history_skipped"] += 1; continue
        if d < since: continue
        if (inv, d, plate13) in covered: continue
        if store == a.store and d >= datetime.date(2021, 8, 2) and any((inv, d, veh) in covered for veh in (plate13,)): continue
        codes = [r[k].strip() for k in ("SCA", "SCB", "SCC", "SCD", "SCE", "SCF", "SCG", "SCH", "SCI", "SCJ", "SCK", "SCL") if r[k].strip()]
        vkey = vehicle_for(plate13); v = vehicles[vkey]; ckey = v["customerId"]
        when = ts(d)
        v["createdAt"] = min(v["createdAt"] or when, when); v["updatedAt"] = max(v["updatedAt"] or 0, when)
        mileage = int(r["MILES"] or 0) or None
        if mileage and mileage > int(v["mileage"] or 0): v["mileage"] = mileage
        oid = f"lsoh{yymmdd(d)}-{inv}" + (f"-s{store}" if store != a.store else "")
        k = 1
        while oid in orders: oid = f"lsoh{yymmdd(d)}-{inv}-{k}"; k += 1
        amt = num(r["AMOUNT"])
        lines = []
        for i, code in enumerate(codes or ["FS"]):
            lines.append({"id": f"lsl{oid[3:]}_{i+1}", "kind": "labor", "description": svc_names.get(code, code), "details": "", "hours": 1, "rate": amt if i == 0 else 0, "unit": "service", "techId": None, "taxable": False, "job": ""})
        notes = list(dict.fromkeys(comments_by.get((plate13, inv, d), [])))
        notes.append(f"LubeSoft visit summary (store {store}); total as recorded, tax included: ${amt:.2f}; services {', '.join(codes) or 'FS'}")
        orders[oid] = {
            "id": oid, "number": inv, "status": "invoiced", "customerId": ckey, "vehicleId": vkey,
            "mileageIn": mileage or "", "mileageOut": "", "concern": "", "notes": " ".join(notes),
            "writerId": None, "techId": None, "lines": lines, "recommendations": [], "stockApplied": True, "noSupplies": True,
            "payments": [{"id": f"lspay{oid[3:]}", "method": "other", "amount": amt, "ref": "LubeSoft history", "at": when}] if amt > 0 else [],
            "createdAt": when, "updatedAt": when, "invoicedAt": when, "approvedAt": when,
            "rules": {"taxRate": 0, "partsTaxable": False, "laborTaxable": False, "subletTaxable": False, "suppliesPct": 0, "suppliesCap": 0, "suppliesTaxable": False, "taxExempt": True},
            "taxOverride": 0,
            "history": [{"at": when, "what": "imported from ISI LubeSoft vehicle history (summary only)"}],
            "ls": {"invoice": inv, "store": store, "total": amt, "summary": True, "serviceCodes": codes},
        }
        stats["history_summaries"] += 1

    # ---- finish up
    owned = {v["customerId"] for v in vehicles.values()}
    customers = {k: c for k, c in customers.items() if not c["ls"]["placeholder"] or k in owned}
    now = int(datetime.datetime.now().timestamp() * 1000)
    for c in customers.values():
        c.setdefault("createdAt", c.get("updatedAt") or now); c["createdAt"] = c["createdAt"] or c.get("updatedAt") or now; c["updatedAt"] = c.get("updatedAt") or c["createdAt"]
    for v in vehicles.values():
        v["createdAt"] = v["createdAt"] or v["updatedAt"] or now; v["updatedAt"] = v["updatedAt"] or v["createdAt"]
    specs = [s for s in specs.values() if s["oilViscosity"]]
    current = [o["number"] for o in orders.values() if o["id"].startswith("lso") and not o["id"].startswith("lsoh")]
    bundle = {
        "format": "shop-desk-import", "version": 1, "source": "ISI LubeSoft", "exportedAt": now,
        "counts": {"customers": len(customers), "vehicles": len(vehicles), "parts": len(parts), "vendors": 0, "orders": len(orders), "jobs": 0, "staff": 0, "specs": len(specs)},
        "nextOrderNumber": max(current) + 1 if current else None,
        "staff": [], "vendors": [], "customers": list(customers.values()), "vehicles": list(vehicles.values()), "parts": list(parts.values()), "jobs": [], "orders": list(orders.values()), "specs": specs,
    }
    json.dump(bundle, open(a.out, "w"), ensure_ascii=False)
    dates = sorted(datetime.date.fromtimestamp(o["invoicedAt"] / 1000) for o in orders.values())
    print("wrote", a.out)
    print("counts", bundle["counts"], "| tickets", dates[0], "to", dates[-1], "| current run", min(current), "to", max(current), "| next number", bundle["nextOrderNumber"])
    print("stats", dict(stats))
    named = sum(1 for c in customers.values() if not c["ls"]["placeholder"])
    print("customers with a name or phone:", named, "| walk-in placeholders kept:", len(customers) - named)
    print("vehicles with VIN:", sum(1 for v in vehicles.values() if v["vin"]), "| with make:", sum(1 for v in vehicles.values() if v["make"]), "| made up from an invoice plate only:", sum(1 for v in vehicles.values() if v["ls"].get("fromInvoice")))
    bad = 0
    for o in orders.values():
        if o["ls"].get("summary"): continue
        sub = sum(round((l["hours"] * l["rate"]) if l["kind"] == "labor" else (-l["price"] if l["kind"] == "discount" else l["qty"] * l["price"]), 2) for l in o["lines"] if l["kind"] != "note")
        if abs(round(sub, 2) - o["ls"]["net"]) > 0.011: bad += 1
    print("detailed tickets whose lines match LubeSoft's net:", stats["invoices"] - bad, "of", stats["invoices"], "| needed an adjustment line:", stats["adjusted"])

if __name__ == "__main__":
    main()
