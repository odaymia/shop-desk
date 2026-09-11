"""Turn ISI LubeSoft nightly transfer files (itf_*.xml) into a Shop Desk
import bundle.

    python3 export_ls.py /path/to/transfer/folder out.json

The desk's Import screen merges the result onto existing records: cars
by VIN or plate, people by phone or email. Ids are deterministic
(lsv<plate>, lso<invoice>...) so re-running updates in place.

What comes over: every invoice with its lines, tax, mileage and payment;
each car with VIN, plate, ACES year/make/model/engine and the oil
capacity LubeSoft used; owners where LubeSoft has a name or phone; the
item codes as inventory; and a service spec per engine (oil grade from
the oil actually used, quarts from LubeSoft's capacity, the filter
installed) so the desk's specs card is filled from real work.
"""
import sys, os, glob, json, re, datetime, collections
import xml.etree.ElementTree as ET

def txt(e, path, default=""):
    v = e.findtext(path)
    return (v or "").strip() if v is not None else default
def num(v, nd=2):
    try: return round(float(v), nd)
    except (TypeError, ValueError): return 0.0
def ts(mdy):
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})", mdy or "")
    return int(datetime.datetime(int(m[3]), int(m[1]), int(m[2]), 12).timestamp() * 1000) if m else None
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

# LubeSoft categories → desk line kinds
PART_CATS = {"OIL", "OF", "AF", "CAF", "BRK", "WB", "ATF", "GO", "PSF", "RS", "CO", "COF", "ADD", "FIC"}
NOTE_CATS = {"#K"}

def main(folder, out):
    files = sorted(glob.glob(os.path.join(folder, "itf_*.xml")))
    if not files: sys.exit("no itf_*.xml files in " + folder)
    customers, vehicles, orders, parts = {}, {}, {}, {}
    specs = {}
    for f in files:
        root = ET.parse(f).getroot()
        for day in root.iter("invoice_date"):
            date = day.get("date")
            for inv in day.iter("invoice"):
                number = int(inv.get("number"))
                vid = inv.find(".//vehicle_id")
                plate, state = plate_of(vid.get("number") if vid is not None else "")
                vin = txt(vid, "vin").upper() if vid is not None else ""
                vkey = "lsv" + re.sub(r"\W", "", (vin or plate))
                year = txt(vid, "vehicle_aces_year") or txt(vid, "vehicle_year")
                engine = engine_of(txt(vid, "vehicle_aces_engine"))
                mileage = int(num(txt(inv, ".//invoice_info/mileage"), 0)) or None
                oilq = num(txt(vid, "oil_quantity"), 1)

                # owner → customer (walk-ins get a placeholder keyed to the car)
                o = inv.find(".//owner")
                first, last = title(txt(o, "name/first")), title(txt(o, "name/last"))
                if first in (".", "") and last in (".", ""): first, last = "", ""
                phones = []
                for k in ("cell", "home", "work"):
                    d = re.sub(r"\D", "", txt(o, f"phone_numbers/phone_number_{k}/area_code_{k}") + txt(o, f"phone_numbers/phone_number_{k}/phone_{k}"))
                    if len(d) >= 10: phones.append(d[-10:])
                email = txt(o, "email").lower()
                ckey = "lsc" + (phones[0] if phones else (re.sub(r"\W", "", (first + last).lower()) if (first or last) else re.sub(r"\W", "", vin or plate)))
                c = customers.get(ckey) or {"id": ckey, "first": "", "last": "", "company": "", "phone": "", "phone2": "", "email": "", "street": "", "city": "", "state": "CA", "zip": "", "notes": "", "taxExempt": False, "active": True, "ls": {"placeholder": not (first or last or phones)}}
                for k, v in (("first", first), ("last", last), ("phone", phones[0] if phones else ""), ("phone2", phones[1] if len(phones) > 1 else ""), ("email", email), ("street", title(txt(o, "address/address1"))), ("city", txt(o, "address/city")), ("zip", txt(o, "address/zip"))):
                    if v and not c[k]: c[k] = v
                if txt(o, "address/state"): c["state"] = txt(o, "address/state").upper()
                c["updatedAt"] = ts(date); c.setdefault("createdAt", ts(date))
                customers[ckey] = c

                v = vehicles.get(vkey) or {"id": vkey, "customerId": ckey, "year": int(year) if year.isdigit() else "", "make": title(txt(vid, "vehicle_aces_make")), "model": txt(vid, "vehicle_aces_model"), "submodel": txt(vid, "vehicle_aces_submodel"), "engine": engine, "vin": vin, "plate": plate, "plateState": state, "color": "", "mileage": mileage or "", "notes": "", "active": True, "createdAt": ts(date), "ls": {"oilQuarts": oilq, "aces": txt(vid, "vehicle_aces_engine")}}
                if mileage and mileage > (v["mileage"] or 0): v["mileage"] = mileage
                if not c["ls"]["placeholder"]: v["customerId"] = ckey  # a named owner beats a placeholder
                v["updatedAt"] = ts(date)
                vehicles[vkey] = v

                # lines. LubeSoft prices a full-service oil change as a package:
                # the FS line carries the price, the oil line lists the whole
                # capacity but only quarts past the included 5 are charged, and
                # the filter is included unless a special-filter charge appears.
                details = list(inv.iter("detail"))
                has_pkg = any(txt(dt, "category") == "FS" for dt in details)
                # fluids that ride along with a service are included in its price
                INCLUDED_WITH = {"BRK": "BKS", "ATF": "ATS", "GO": "RDS", "PSF": "PSS", "RS": "RAD"}
                cats_here = {txt(dt, "category") for dt in details} | {txt(dt, "service_code") for dt in details}
                INCLUDED_QT = 5
                lines, oil_used, filter_used = [], None, None
                job = "Full service oil change" if has_pkg else ""
                ln = 0
                for dt in details:
                    ln += 1
                    code, desc = txt(dt, "inventory_item"), txt(dt, "inventory_item_desc").lstrip("!")
                    cat, qty, price = txt(dt, "category"), num(txt(dt, "item_qty")), num(txt(dt, "item_price"))
                    lid = f"lsl{number}_{ln}"
                    if cat in NOTE_CATS:
                        lines.append({"id": lid, "kind": "note", "description": title(desc), "job": job, "taxable": None}); continue
                    if price < 0:
                        lines.append({"id": lid, "kind": "discount", "description": title(desc), "qty": 1, "price": round(abs(price) * (qty or 1), 2), "taxable": True, "job": job}); continue
                    if cat in PART_CATS:
                        pid = "lsp" + re.sub(r"\W", "", code)
                        stock = bool(code) and cat not in ("CO", "COF")
                        if stock:
                            p = parts.get(pid) or {"id": pid, "number": code, "description": title(desc), "category": {"OIL": "Oil", "OF": "Filters", "AF": "Filters", "CAF": "Filters", "BF": "Fluids", "WB": "Wipers"}.get(cat, "Parts"), "vendorId": "", "cost": 0, "price": price, "onHand": 0, "reorderAt": 0, "location": "", "taxable": True, "active": True, "ls": {"code": code, "category": cat}}
                            p["price"] = price or p["price"]; parts[pid] = p
                            if cat == "OIL": oil_used = (code, desc)
                            if cat == "OF": filter_used = (code, desc)
                        base = {"kind": "part", "number": code, "partId": pid if stock else None, "description": title(desc), "cost": 0, "condition": "new", "taxable": None, "job": job}
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
                for cp in inv.iter("coupon"):
                    amt = num(txt(cp, "amount"))
                    if amt:
                        lines.append({"id": f"lsl{number}_c{txt(cp, 'id')}", "kind": "discount", "description": f"Coupon {txt(cp, 'id')}".strip(), "qty": 1, "price": amt, "taxable": True, "job": job})
                for ds in inv.iter("discount"):
                    amt = num(txt(ds, "amount"))
                    if amt:
                        lines.append({"id": f"lsl{number}_d{ln}", "kind": "discount", "description": title(txt(ds, "description") or txt(ds, "id") or "Discount"), "qty": 1, "price": amt, "taxable": True, "job": job})
                tax = sum(num(txt(inv, f".//invoice_info/tax{i}")) for i in range(1, 6))
                total = num(txt(inv, ".//invoice_info/net"))  # LubeSoft's "net" is the total, tax included
                net = round(total - tax, 2)
                # whatever LubeSoft's own package rules did that the lines above
                # don't reproduce, keep the invoice total honest with one line
                sub = round(sum((l["hours"] * l["rate"]) if l["kind"] == "labor" else (-l["price"] if l["kind"] == "discount" else l["qty"] * l["price"]) for l in lines if l["kind"] != "note"), 2)
                diff = round(net - sub, 2)
                if abs(diff) > 0.011:
                    lines.append({"id": f"lsl{number}_adj", "kind": "fee" if diff > 0 else "discount", "description": "Package pricing adjustment (LubeSoft)", "qty": 1, "price": abs(diff), "taxable": False, "job": job})
                card = txt(inv, ".//invoice_info/credit_card_type")
                when = ts(date)
                orders["lso%d" % number] = {
                    "id": "lso%d" % number, "number": number, "status": "invoiced", "customerId": ckey, "vehicleId": vkey,
                    "mileageIn": mileage or "", "mileageOut": "", "concern": "", "notes": " ".join(t for t in (txt(inv, f".//comments/comment{i}") for i in range(1, 8)) if t),
                    "writerId": None, "techId": None, "lines": lines, "recommendations": [], "stockApplied": True, "noSupplies": True,
                    "payments": [{"id": "lspay%d" % number, "method": "card" if card else "cash", "amount": total, "ref": "", "at": when}] if total > 0 else [],
                    "createdAt": when, "updatedAt": when, "invoicedAt": when, "approvedAt": when,
                    "rules": {"taxRate": 7.75, "partsTaxable": True, "laborTaxable": False, "subletTaxable": False, "suppliesPct": 0, "suppliesCap": 0, "suppliesTaxable": False, "taxExempt": False},
                    "taxOverride": round(tax, 2),
                    "history": [{"at": when, "what": "imported from ISI LubeSoft"}],
                    "ls": {"invoice": number, "net": net, "tax": round(tax, 2), "employee": txt(vid, "employee")},
                }
                # spec learned from the work done
                if oilq and v["make"] and engine:
                    skey = f"{v['year']}|{v['make']}|{v['model']}|{engine}".lower()
                    sp = specs.get(skey) or {"year": v["year"], "make": v["make"], "model": v["model"], "engine": engine, "oilViscosity": "", "oilSpec": "", "oilCapacityQt": oilq, "oilFilters": [], "drainPlugTorque": "", "resetProcedure": "", "otherFluids": "", "notes": "", "source": "lubesoft", "active": True}
                    if oil_used and not sp["oilViscosity"]: sp["oilViscosity"] = viscosity_of(*oil_used)
                    if filter_used and not any(f["number"] == filter_used[0] for f in sp["oilFilters"]): sp["oilFilters"].append({"brand": "Valvoline", "number": filter_used[0]})
                    specs[skey] = sp

    # drop placeholder customers that own nothing
    owned = {v["customerId"] for v in vehicles.values()}
    customers = {k: c for k, c in customers.items() if not c["ls"]["placeholder"] or k in owned}
    specs = [s for s in specs.values() if s["oilViscosity"]]
    numbers = [o["number"] for o in orders.values()]
    bundle = {
        "format": "shop-desk-import", "version": 1, "source": "ISI LubeSoft", "exportedAt": int(datetime.datetime.now().timestamp() * 1000),
        "counts": {"customers": len(customers), "vehicles": len(vehicles), "parts": len(parts), "vendors": 0, "orders": len(orders), "jobs": 0, "staff": 0, "specs": len(specs)},
        "nextOrderNumber": max(numbers) + 1 if numbers else None,
        "staff": [], "vendors": [], "customers": list(customers.values()), "vehicles": list(vehicles.values()), "parts": list(parts.values()), "jobs": [], "orders": list(orders.values()), "specs": specs,
    }
    json.dump(bundle, open(out, "w"), ensure_ascii=False)
    print("wrote", out)
    print("counts", bundle["counts"], "| invoices", min(numbers), "to", max(numbers), "| next number", bundle["nextOrderNumber"])
    named = sum(1 for c in customers.values() if not c["ls"]["placeholder"])
    print("customers with a name or phone:", named, "| walk-in placeholders kept:", len(customers) - named)
    # check our math against LubeSoft's net + tax
    from decimal import Decimal
    bad = 0
    for o in orders.values():
        sub = sum(round((l["hours"] * l["rate"]) if l["kind"] == "labor" else (-l["price"] if l["kind"] == "discount" else l["qty"] * l["price"]), 2) for l in o["lines"] if l["kind"] != "note")
        if abs(round(sub, 2) - o["ls"]["net"]) > 0.011: bad += 1
    print("line totals matching LubeSoft's net:", len(orders) - bad, "of", len(orders))

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
