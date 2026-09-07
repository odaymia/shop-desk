"""Turn a Mitchell1 Manager SE backup into a Shop Desk import bundle.

    python3 export_m1.py /path/to/backup.bak out.json

The bundle is plain JSON the desk's Settings → Import screen reads. Ids
are deterministic (m1c<CustId>, m1v<VehicleId>, m1o<RepairOrderId>...) so
importing twice updates instead of duplicating.
"""
import sys, json, collections, datetime, decimal, re
import bak as B

D = decimal.Decimal
def money(v):
    if v is None: return 0
    return float(round(D(v), 2))
def num(v, nd=2):
    if v is None: return 0
    return float(round(D(v), nd))
def ts(dt):
    if not dt: return None
    if isinstance(dt, datetime.datetime): return int(dt.timestamp() * 1000)
    return None
def s(v):
    return (v or "").strip() if isinstance(v, str) else ("" if v is None else str(v))
def phone(p):
    d = re.sub(r"\D", "", s(p))
    return d if len(d) >= 7 and not d.startswith("000") else ""

def main(path, out, keep_canned=False):
    b = B.Bak(path)
    t = B.user_tables(b)
    R = lambda n: list(B.rows(b, t[n])) if n in t else []
    by = lambda rows, key: {r[key]: r for r in rows}
    group = lambda rows, key: (lambda g: [g[r[key]].append(r) for r in rows] and g)(collections.defaultdict(list))

    report = {}
    # ---------- lookups ----------
    make = {m["MakeId"]: s(m["Name"]) for m in R("Make")}
    model = by(R("Model"), "ModelId")
    submodel = by(R("SubModel"), "SubModelId")
    engine = by(R("Engine"), "EngineId")
    category = {c["CategoryId"]: s(c["Description"]) for c in R("Category")}
    acct = {a["AccountClassId"]: s(a["AccountType"]) for a in R("AccountClass")}
    taxrates = by(R("TaxRates"), "TaxRateId")
    phones = by(R("PhoneNum"), "PhoneId")
    phonedesc = {p["PhoneDescId"]: s(p["Description"]) for p in R("PhoneDesc")}
    addresses = by(R("Addresses"), "AddressId")
    emails = by(R("Email"), "Id")

    # ---------- staff ----------
    staff = []
    for e in R("Employee"):
        name = f"{s(e['FirstName'])} {s(e['LastName'])}".strip()
        if e["EmployeeId"] == 1 or not name: continue
        role = {1: "Technician", 2: "Service writer", 3: "Manager"}.get(e["EmployeeTypeId"], "")
        staff.append({"m1Id": e["EmployeeId"], "name": name.title() if name.isupper() else name, "role": role,
                      "active": not (e["Inactive"] or e["Deleted"])})
    staffKey = {x["m1Id"]: "m1e%d" % x["m1Id"] for x in staff}
    for x in staff: x["id"] = staffKey[x["m1Id"]]

    # ---------- vendors ----------
    vendorPhones = group(R("VendorPhones"), "VendorId")
    vendors = []
    for v in R("Vendor"):
        ph = ""
        for vp in vendorPhones.get(v["VendorId"], []):
            p = phones.get(vp["PhoneId"])
            if p and phone(p["PhoneNum"]): ph = phone(p["PhoneNum"]); break
        vendors.append({"id": "m1vend%d" % v["VendorId"], "name": s(v["Name"]), "phone": ph, "email": s(v["EmailAddress"]),
                        "account": s(v["Code"]), "notes": s(v["Contact"]), "active": not v["Deleted"], "createdAt": ts(v["LastChangeDate"])})

    # ---------- customers ----------
    custPhones = group(R("CustomerPhones"), "CustId")
    custAddr = group(R("CustomerAddresses"), "CustID")
    custEmails = group(R("CustomerEmails"), "CustId")
    customers = []
    for c in R("Customers"):
        pl = []
        for cp in custPhones.get(c["CustId"], []):
            p = phones.get(cp["PhoneId"])
            if p and phone(p["PhoneNum"]): pl.append((phonedesc.get(p["PhoneDescId"], ""), phone(p["PhoneNum"])))
        pl.sort(key=lambda x: 0 if x[0] == "Cellular" else 1)
        addr = None
        for ca in custAddr.get(c["CustId"], []):
            a = addresses.get(ca["AddressId"])
            if a and (a["AddressTypeId"] == 1 or addr is None): addr = a
        em = ""
        for ce in sorted(custEmails.get(c["CustId"], []), key=lambda x: (not x["IsSelected"], x["SortOrder"])):
            e = emails.get(ce["EmailId"])
            if e and s(e["Email"]): em = s(e["Email"]).lower(); break
        first, last = s(c["FirstName"]), s(c["LastName"])
        fix = lambda x: x.title() if x.isupper() else x
        customers.append({
            "id": "m1c%d" % c["CustId"], "first": fix(first), "last": fix(last),
            "company": s(addr["Company"]) if addr else "",
            "phone": pl[0][1] if pl else "", "phone2": pl[1][1] if len(pl) > 1 else "", "email": em,
            "street": fix(s(addr["Address"])) if addr else "", "city": s(addr["City"]) if addr else "",
            "state": s(addr["State"]) if addr and s(addr["State"]) else "CA", "zip": s(addr["ZipCode"]) if addr else "",
            "notes": s(c["Remarks"]).replace("\r\n", "\n").strip(), "taxExempt": bool(c["TaxExempt"]), "active": not c["IsDeleted"],
            "createdAt": ts(c["FirstVisited"]) or ts(c["LastChangeDate"]), "updatedAt": ts(c["LastChangeDate"]),
            "m1": {"custId": c["CustId"], "balanceDue": money(c["BalanceDue"]), "lastVisited": ts(c["LastVisited"])},
        })
    # placeholder customers ("-", "+", blank) with no tickets go in as inactive
    ticketCust = collections.Counter("m1c%d" % ro["CustId"] for ro in R("RepairOrder") if ro["CustId"])
    placeholders = 0
    for c in customers:
        hasName = bool(re.search(r"[A-Za-z0-9]", c["first"] + c["last"] + c["company"]))
        if not hasName and not ticketCust.get(c["id"]):
            c["active"] = False
            placeholders += 1
    report["placeholderCustomers"] = placeholders
    custIds = {c["id"] for c in customers}

    # ---------- vehicles ----------
    # Manager SE drops the customer off a vehicle row in some flows (quick
    # sales, merged customers); the tickets still say whose car it was.
    vehCust = {}
    for ro in R("RepairOrder"):
        if ro["VehicleId"] and ro["CustId"]:
            vehCust.setdefault(ro["VehicleId"], collections.Counter())[ro["CustId"]] += 1
    recovered = 0
    vehicles = []
    for v in R("Vehicle"):
        custId = v["CustId"]
        if not custId and v["VehicleId"] in vehCust:
            custId = vehCust[v["VehicleId"]].most_common(1)[0][0]
            recovered += 1
        sm = submodel.get(v["SubModelId"]) if v["SubModelId"] is not None else None
        md = model.get(sm["ModelId"]) if sm else None
        en = engine.get(v["EngineId"]) if v["EngineId"] else None
        eng = ""
        if en:
            bits = []
            if en.get("DisplacementLiters"): bits.append("%.1fL" % float(en["DisplacementLiters"]))
            if en.get("NumberOfCylinders"): bits.append("%s-cyl" % en["NumberOfCylinders"])
            if en.get("BoostType") and en["BoostType"] not in ("Normal", None): bits.append(s(en["BoostType"]))
            eng = " ".join(bits)
        mfg = None
        m = re.match(r"(\d{4})/(\d{1,2})/(\d{1,2})", s(v["MfgDate"]))
        if m:
            try: mfg = ts(datetime.datetime(int(m[1]), int(m[2]), int(m[3])))
            except ValueError: pass
        vehicles.append({
            "id": "m1v%d" % v["VehicleId"], "customerId": "m1c%d" % custId if custId else None,
            "year": v["Year"] or "", "make": make.get(v["MakeId"], "") or (md and make.get(md["MakeId"], "")) or "",
            "model": s(md["Name"]) if md else "", "submodel": s(sm["Name"]) if sm else "", "engine": eng,
            "vin": s(v["Vin"]).upper(), "plate": s(v["License"]).upper(), "plateState": s(v["LicenseState"]) or "CA",
            "color": s(v["Color"]), "mileage": v["Odometer1"] or "", "notes": s(v["VehicleMemo"]).replace("\r\n", "\n").strip(),
            "active": not v["Deleted"], "createdAt": mfg or ts(v["LastChangeDate"]), "updatedAt": ts(v["LastChangeDate"]),
            "m1": {"vehicleId": v["VehicleId"], "unitNo": s(v["UnitNo"])},
        })
    # keep a vehicle if a customer owns it or any ticket names it
    ticketVeh = {"m1v%d" % ro["VehicleId"] for ro in R("RepairOrder") if ro["VehicleId"]}
    dropped = sum(1 for v in vehicles if v["customerId"] not in custIds and v["id"] not in ticketVeh)
    vehicles = [v for v in vehicles if v["customerId"] in custIds or v["id"] in ticketVeh]
    for v in vehicles:
        if v["customerId"] not in custIds: v["customerId"] = None
    report["vehiclesRecovered"] = recovered
    report["vehiclesDroppedNoCustomer"] = dropped

    # ---------- parts ----------
    inv = by(R("Inventory"), "PartId")
    pnums = group(R("PartNumber"), "PartId")
    pvend = group(R("PartVendor"), "PartId")
    parts = []
    for p in R("Part"):
        i = inv.get(p["PartId"], {})
        nums = sorted(pnums.get(p["PartId"], []), key=lambda x: not x["IsBasePart"])
        pv = sorted(pvend.get(p["PartId"], []), key=lambda x: x["Priority"] or 99)
        parts.append({
            "id": "m1p%d" % p["PartId"], "number": s(nums[0]["PartNumber"]).upper() if nums else "",
            "description": s(p["Description"]), "category": category.get(p["CategoryId"], ""),
            "vendorId": "m1vend%d" % pv[0]["VendorId"] if pv else "", "cost": money(p["Cost"]), "price": money(p["Price"]),
            "onHand": num(i.get("OnHand"), 2), "reorderAt": num(i.get("OrderPoint"), 2), "location": s(i.get("Location")),
            "taxable": not p["TaxExempt"], "active": not p["IsDeleted"], "createdAt": ts(p["LastChangeDate"]), "updatedAt": ts(p["LastChangeDate"]),
            "size": s(p["Size"]), "tire": bool(p["IsTire"]), "m1": {"partId": p["PartId"], "lastCost": money(i.get("LastCost"))},
        })
        if parts[-1]["tire"]:
            # "175/70R14 84T" → size 175/70R14, load/speed 84T; brand/model from "Ironman, iMOVE PT"
            raw = parts[-1]["size"].upper().strip()
            m = re.match(r"^[PLT]*\s*(\d{3})\s*[/-]?\s*/?\s*(\d{2,3})\s*[/-]?\s*Z?R?\s*(\d{2}(?:\.\d)?)(C?)(.*)$", raw)
            f = re.match(r"^(\d{2})X(\d{1,2}(?:\.\d{1,2})?)R?(\d{2})(LT)?(.*)$", raw)
            if m:
                parts[-1]["size"] = f"{m[1]}/{m[2]}R{m[3]}{m[4]}"
                parts[-1]["loadSpeed"] = re.sub(r"^[/\s]+", "", m[5]).strip()  # "94H", "XL 99Y", "10 120/1"
            elif f:
                parts[-1]["size"] = f"{f[1]}X{f[2]}R{f[3]}{f[4] or ''}"
                parts[-1]["loadSpeed"] = f[5].strip()
            desc = parts[-1]["description"]
            if "," in desc:
                br, mo = desc.split(",", 1)
                parts[-1]["brand"], parts[-1]["model"] = br.strip(), mo.strip()
                parts[-1]["description"] = f"{br.strip()} {mo.strip()}".strip()
            parts[-1]["category"] = "Tires"

    # ---------- orders ----------
    lineitems = by(R("LineItem"), "LineItemId")
    partitem = by(R("PartItem"), "LineItemId")
    laboritem = by(R("LaborItem"), "LineItemId")
    noteitem = by(R("NoteItem"), "LineItemId")
    coupon = by(R("CouponItem"), "LineItemId")
    sublet = by(R("SubletItem"), "LineItemId")
    seq = group(R("RepairOrderLineItemSequence"), "RepairOrderId")
    jobs = by(R("Job"), "Id")
    recnum = {r["RepairOrderId"]: r["RecordNumberId"] for r in R("RecordNumber")}
    payments = group(R("Payment"), "RepairOrderId")
    taxsum = by(R("RepairOrderTaxSummary"), "RepairOrderId")
    roTechs = group(R("RepairOrderTechs"), "RepairOrderId")
    lineTechs = group(R("LineItemTechs"), "LineItemId")
    phase = {p["RepairOrderPhaseId"]: s(p["Phase"]) for p in R("RepairOrderPhase")}
    PHASE_STATUS = {"EST": "estimate", "SCHEDULED": "estimate", "RO": "open", "RO/S": "open", "INV": "open",
                    "P_INV": "invoiced", "P_CSALE": "invoiced", "CSALE": "open", "DELETED": "void"}
    PAY = {"C1": "cash", "C2": "check", "C3": "card"}

    def make_line(li, jobTitle):
        lid = li["LineItemId"]
        desc = s(li["Description"]).replace("\r\n", "\n").strip()
        base = {"id": "m1l%d" % lid, "description": desc, "job": jobTitle, "taxable": None}
        if lid in coupon:
            c = coupon[lid]
            amt = money(c["ActualLaborDiscount"]) + money(c["ActualPartsDiscount"])
            note = s(noteitem[lid]["NoteText"]) if lid in noteitem else ""
            note = re.sub(r"\*+\s*Discount\s*\*+", "", note, flags=re.I).strip()
            return {**base, "kind": "discount", "description": note or "Discount", "qty": 1, "price": round(amt, 2),
                    "taxable": money(c["ActualPartsDiscount"]) > 0}
        if lid in partitem:
            p = partitem[lid]
            if li["TireFee"]:
                return {**base, "kind": "fee", "description": desc or "CA tire recycling fee", "qty": num(p["Quantity"]),
                        "price": money(p["UnitSale"]), "taxable": False}
            tech = next((x["EmployeeId"] for x in lineTechs.get(lid, []) if x["EmployeeId"]), None)
            return {**base, "kind": "part", "number": s(p["PartNo"]).upper(), "partId": ("m1p%d" % p["PartId"]) if p["PartId"] else None,
                    "qty": num(p["Quantity"]), "price": money(p["UnitSale"]), "cost": money(p["UnitCost"]),
                    "taxable": False if li["TaxExempt"] else None, "vendor": s(p.get("PurchasedFromVendor"))}
        if lid in laboritem:
            l = laboritem[lid]
            hours = num(l["HoursCharged"], 2)
            sale = money(li["Sale"])
            rate = round(sale / hours, 4) if hours else sale
            tech = next((x["EmployeeId"] for x in lineTechs.get(lid, []) if x["EmployeeId"]), None)
            wp = l.get("WorkPerformed")
            details = s(wp).replace("\r\n", "\n").strip() if isinstance(wp, str) else ""
            line = {**base, "kind": "labor", "details": details, "hours": hours if hours else 1, "rate": rate if hours else sale,
                    "techId": staffKey.get(tech), "taxable": None}
            if not hours:
                line["hours"], line["rate"] = 1, sale
            return line
        if lid in sublet:
            return {**base, "kind": "sublet", "qty": 1, "price": money(li["Sale"]), "cost": money(li["Cost"]),
                    "taxable": False if li["TaxExempt"] else None}
        if lid in noteitem:
            return {**base, "kind": "note", "description": s(noteitem[lid]["NoteText"]).replace("\r\n", "\n").strip() or desc}
        sale = money(li["Sale"])
        if sale:
            return {**base, "kind": "fee", "qty": 1, "price": sale, "taxable": not li["TaxExempt"]}
        return {**base, "kind": "note"}

    orders = []
    mismatches = []
    for ro in R("RepairOrder"):
        rid = ro["RepairOrderId"]
        status = PHASE_STATUS.get(phase.get(ro["RepairOrderPhaseId"]), "open")
        lines = []
        for sq in sorted(seq.get(rid, []), key=lambda x: (x["Sequence"] or 0, x["LineItemId"])):
            li = lineitems.get(sq["LineItemId"])
            if not li: continue
            jt = ""
            if sq["JobId"] and sq["JobId"] in jobs:
                jt = s(jobs[sq["JobId"]]["Title"])
                jt = jt.split(" - [")[0][:80]
            lines.append(make_line(li, jt))
        pays = []
        for p in sorted(payments.get(rid, []), key=lambda x: (x["PaymentDate"] or datetime.datetime(1900, 1, 1), x["PaymentId"])):
            if p["InvoiceStatusId"] == 4 or p["DeletionDate"]: continue
            amt = money(p["Amount"])
            if p["IsNSF"]: amt = -abs(amt)
            pays.append({"id": "m1pay%d" % p["PaymentId"], "method": PAY.get(acct.get(p["AccountClassId"], ""), "other"),
                         "amount": amt, "ref": s(p["CheckData"]) or s(p["AuthData"]), "at": ts(p["PaymentDate"]) or ts(ro["DatePosted"]) or 0,
                         "m1": {"accountClassId": p["AccountClassId"]}})
        tsum = taxsum.get(rid)
        rate = 0.0
        if tsum and tsum["TaxRateId"] in taxrates:
            rate = num(taxrates[tsum["TaxRateId"]]["MatlRate"], 3)
        writer = next((x["TechnicianId"] for x in roTechs.get(rid, []) if x["TechRoleId"] == 1), None)
        created = ts(ro["TimeIn"]) or ts(ro["DatePosted"]) or ts(ro["LastChangeDate"])
        number = recnum.get(rid)
        o = {
            "id": "m1o%d" % rid, "number": number if number else 900000 + rid, "status": status,
            "customerId": ("m1c%d" % ro["CustId"]) if ro["CustId"] else None, "vehicleId": ("m1v%d" % ro["VehicleId"]) if ro["VehicleId"] else None,
            "mileageIn": ro["OdometerIn"] or "", "mileageOut": ro["OdometerOut"] or "",
            "concern": s(ro["Notes"]).strip(), "notes": s(ro["Observations"]).strip(),
            "writerId": staffKey.get(writer), "techId": None, "lines": lines, "payments": pays, "recommendations": [],
            "stockApplied": True, "noSupplies": True,
            "createdAt": created, "updatedAt": ts(ro["LastChangeDate"]) or created,
            "invoicedAt": ts(ro["DatePosted"]) if status in ("invoiced", "void") else None,
            "approvedAt": created if status != "estimate" else None,
            "history": [{"at": created, "what": "imported from Mitchell1 Manager SE"}],
            "m1": {"repairOrderId": rid, "phase": phase.get(ro["RepairOrderPhaseId"]), "orderTotal": money(ro["OrderTotal"]),
                   "tax": money(ro["TotalTaxAmt"]), "labor": money(ro["LaborSale"]), "parts": money(ro["PartsSale"]),
                   "discount": money(ro["DiscountAmt"]), "tireFee": money(ro["TireFeeSale"]), "noRecordNumber": number is None},
        }
        if status in ("invoiced", "void"):
            o["rules"] = {"taxRate": rate, "partsTaxable": True, "laborTaxable": False, "subletTaxable": False,
                          "suppliesPct": 0, "suppliesCap": 0, "suppliesTaxable": False, "taxExempt": bool(ro["TaxExempt"])}
            o["taxOverride"] = money(ro["TotalTaxAmt"])
        # check our math against Mitchell's total
        sub = 0.0
        for l in lines:
            if l["kind"] == "labor": sub += round(l["hours"] * l["rate"], 2)
            elif l["kind"] == "discount": sub -= l["price"]
            elif l["kind"] != "note": sub += round(l["qty"] * l["price"], 2)
        total = round(sub + money(ro["TotalTaxAmt"]), 2)
        if abs(total - money(ro["OrderTotal"])) > 0.011:
            mismatches.append((o["number"], total, money(ro["OrderTotal"]), status))
        orders.append(o)

    # ---------- canned jobs ----------
    cjseq = group(R("CannedJobLineItemSequence"), "CannedJobId")
    cjobs = []
    for cj in R("CannedJob"):
        ls = []
        for sq in sorted(cjseq.get(cj["CannedJobId"], []), key=lambda x: x["Sequence"] or 0):
            li = lineitems.get(sq["LineItem"])
            if not li: continue
            l = make_line(li, "")
            if l["kind"] == "labor": ls.append({"kind": "labor", "description": l["description"], "details": l.get("details", ""), "hours": l["hours"], "rate": l["rate"] or None})
            elif l["kind"] == "part": ls.append({"kind": "part", "description": l["description"], "number": l.get("number", ""), "partId": l.get("partId"), "qty": l["qty"], "price": l["price"] or None, "cost": l.get("cost") or None})
            elif l["kind"] == "fee": ls.append({"kind": "fee", "description": l["description"], "qty": l["qty"], "price": l["price"]})
        if not ls: continue
        name = s(cj["Description"]) or s(cj["Name"])
        # Manager SE's stock canned-job list is mostly generic labor-guide
        # entries. Unless asked to keep them, they go in as deleted so a
        # re-import removes any that came over earlier.
        cjobs.append({"id": "m1j%d" % cj["CannedJobId"], "name": name, "category": category.get(cj["CategoryId"], ""), "unit": "", "lines": ls,
                      "active": keep_canned, "deleted": not keep_canned, "createdAt": ts(cj["LastChangeDate"]), "m1": {"code": s(cj["Name"])}})

    # ---------- special packages (Manager SE's menu-priced Good/Better/Best,
    # oil change menu, tire packages) → canned jobs ----------
    spType = {x["SpecialPackageTypeId"]: s(x["SpecialPackageType"]) for x in R("SpecialPackageType")}
    spCat = by(R("SpecialPackageCategory"), "SpecialPackageCategoryId")
    spSeq = group(R("SpecialPackageLineItemSequence"), "SpecialPackageId")
    TYPE_CAT = {"Tire": "Tires", "Brake": "Brakes", "LOF": "Oil"}
    for sp in R("SpecialPackage"):
        desc = s(sp["Description"])
        rows = spSeq.get(sp["SpecialPackageId"], [])
        if not desc or desc.upper() == "DO NOT USE" or not rows: continue
        cat = spCat.get(sp["SpecialPackageCategoryId"], {})
        typ = spType.get(cat.get("SpecialPackageTypeId"), "")
        perTire = typ == "Tire"
        ls = []
        for sq in sorted(rows, key=lambda x: x["Sequence"] or 0):
            li = lineitems.get(sq["LineItemId"])
            if not li: continue
            l = make_line(li, "")
            per = perTire and bool(sq.get("UsePackageQuantity"))
            if l["kind"] == "labor":
                if per: ls.append({"kind": "labor", "description": l["description"], "details": l.get("details", ""), "hours": 1, "rate": round(money(li["Sale"]), 2), "perUnit": True})
                else: ls.append({"kind": "labor", "description": l["description"], "details": l.get("details", ""), "hours": l["hours"], "rate": l["rate"] or None})
            elif l["kind"] == "part":
                if not l["qty"]: continue
                ls.append({"kind": "part", "description": l["description"], "number": "" if l.get("number") == "XXXX" else l.get("number", ""),
                           "partId": l.get("partId"), "qty": l["qty"], "price": l["price"], "cost": l.get("cost") or None, "condition": "new", "perUnit": per})
            elif l["kind"] == "fee":
                ls.append({"kind": "fee", "description": l["description"], "qty": l["qty"], "price": l["price"], "perUnit": per})
            elif l["kind"] == "note" and l["description"]:
                ls.append({"kind": "note", "description": l["description"][:200]})
        if not any(x["kind"] in ("labor", "part", "fee") for x in ls): continue
        name = f"{s(cat.get('CategoryDescription'))}: {desc}" if s(cat.get("CategoryDescription")) else desc
        name = " ".join(w if not w.isupper() or len(w) <= 3 else w.title() for w in name.split())
        # the oil change menu (LOF) is left out at the shop's request; it goes
        # in as deleted so a re-import clears any that came over earlier
        skip = typ == "LOF"
        cjobs.append({"id": "m1sp%d" % sp["SpecialPackageId"], "name": name, "category": TYPE_CAT.get(typ, typ),
                      "unit": "tire" if perTire else "", "lines": ls, "active": not skip, "deleted": skip,
                      "createdAt": ts(sp.get("LastChangeDate")), "m1": {"specialPackageId": sp["SpecialPackageId"], "type": typ}})

    numbers = [o["number"] for o in orders if o["number"] < 900000]
    bundle = {
        "format": "shop-desk-import", "version": 1, "source": "Mitchell1 Manager SE", "exportedAt": ts(datetime.datetime.now()),
        "counts": {"customers": len(customers), "vehicles": len(vehicles), "parts": len(parts), "vendors": len(vendors),
                   "orders": len(orders), "jobs": sum(1 for j in cjobs if not j.get("deleted")), "staff": len(staff)},
        "nextOrderNumber": (max(numbers) + 1) if numbers else None,
        "staff": staff, "vendors": vendors, "customers": customers, "vehicles": vehicles, "parts": parts, "jobs": cjobs, "orders": orders,
    }
    json.dump(bundle, open(out, "w"), ensure_ascii=False)
    st = collections.Counter(o["status"] for o in orders)
    print("wrote", out)
    print("counts", bundle["counts"], "statuses", dict(st), "next number", bundle["nextOrderNumber"])
    print("placeholder customers set inactive:", report["placeholderCustomers"])
    print("vehicles recovered from tickets", report["vehiclesRecovered"], "dropped (no customer anywhere)", report["vehiclesDroppedNoCustomer"])
    vids = {v["id"] for v in vehicles}
    print("tickets whose vehicle is missing:", sum(1 for o in orders if o["vehicleId"] and o["vehicleId"] not in vids))
    print("totals matching Mitchell's:", len(orders) - len(mismatches), "of", len(orders))
    for m in mismatches[:15]: print("   mismatch #%s ours %.2f theirs %.2f (%s)" % m)
    return bundle

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], keep_canned="--keep-canned-jobs" in sys.argv)
