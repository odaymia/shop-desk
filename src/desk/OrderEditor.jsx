import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Modal, Field, Text, Num, Money, fmtDate, fmtDateTime, fmtPhone, toNum } from "./ui.jsx";
import { CustomerForm, CustomerPicker, VehicleForm } from "./forms.jsx";
import { PartPicker, JobPicker } from "./pickers.jsx";
import { ConfirmDelete } from "./Orders.jsx";
import { customerName, vehicleName, vehiclesOf, ordersOf } from "./useShop.js";
import { serviceCodes } from "../lib/serviceCodes.js";
import { orderPayout } from "../lib/commission.js";
import { applicableCoupons, couponDiscount, couponValueText, orderJobNames, orderSubtotalBase } from "../lib/coupons.js";
import { symptomGroups, addSymptom } from "../lib/symptoms.js";
import { makeRevision, withRevision, revisionCount } from "../lib/revisions.js";
import { hasOilChange } from "../lib/sticker.js";
import { Sticker } from "./Sticker.jsx";
import {
  STATUS,
  PAY_METHODS,
  lineAmount,
  lineTaxable,
  makeLine,
  orderTotals,
  orderTitle,
  rulesFor,
  statusLabel,
  jobLines,
  owesBalance,
  fmtMoney,
  PART_CONDITIONS,
  crewAssigned,
} from "../lib/invoice.js";
import { uid } from "../lib/ids.js";
import { CATALOGS, cartToLines } from "../lib/parts.js";
import { findSpec, matchOil, matchFilter } from "../lib/specs.js";
import { loadValvolineSpecs, findValvolineSpec } from "../lib/valvolineSpecs.js";
import { valvolineFor } from "../lib/valvoline.js";
import { SpecForm } from "./SpecForm.jsx";
import { OilChangePicker } from "./OilChangePicker.jsx";
import { ChecklistModal, ChecklistCard } from "./ChecklistModal.jsx";
import { priorChecklist, syncChecklist } from "../lib/checklist.js";
import { cloud, sGet, sSet, sList } from "../storage/index.js";
import { CART_PREFIX, SIGNREQ_KEY, INFOREQ_KEY } from "../lib/keys.js";
import { OrderSign } from "./Signing.jsx";
import { PortalQR } from "./QR.jsx";
import { tireName } from "../lib/tires.js";

/* Service-menu buttons whose job is really "put a part on the ticket" open
   the inventory list filtered to that category instead of the canned-job
   picker. Matched on the button's category or name so it works without the
   shop re-saving its menu; a menu item can also set `partCat` outright. */
const MENU_PART_CATS = {
  "air filters": "Engine Air Filters",
  "air filter": "Engine Air Filters",
  "engine air filters": "Engine Air Filters",
  "engine air filter": "Engine Air Filters",
  "cabin air filters": "Cabin Air Filters",
  "cabin air filter": "Cabin Air Filters",
  wipers: "Wipers",
  wiper: "Wipers",
  "wiper blades": "Wipers",
};
function menuPartCat(m) {
  if (m.partCat) return m.partCat;
  const key = String(m.category || m.name || "").trim().toLowerCase();
  return MENU_PART_CATS[key] || (/wiper/.test(key) ? "Wipers" : "");
}

/* One ticket: estimate → repair order → invoice. Edits save themselves a
   moment after you stop typing. Once posted, the lines lock; only
   payments can change. */

export function OrderEditor({ orderId, shop, cfg, employees, nav, flash }) {
  const order = shop.orders[orderId];
  const [draft, setDraft] = useState(order);
  const draftRef = useRef(order);
  const dirty = useRef(false);
  const timer = useRef(null);
  const stickerAfterChecklist = useRef(null); // sticker to print once a post-time checklist is closed
  const saveRef = useRef(shop.saveOrder);
  saveRef.current = shop.saveOrder;
  const [pick, setPick] = useState(null); // customer | part | job | pay | confirm
  const [jobCat, setJobCat] = useState(""); // the menu button that opened the job picker
  const [partCat, setPartCat] = useState(""); // inventory category a menu button opened the part picker to
  const [signing, setSigning] = useState(false);
  const [vehEdit, setVehEdit] = useState(null);
  const [custEdit, setCustEdit] = useState(false);
  const [specEdit, setSpecEdit] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [showRevs, setShowRevs] = useState(false);
  const [sticker, setSticker] = useState(null); // { id, auto } — the reminder sticker to print

  /* When the car has no oil spec on file, pull Valvoline's for its exact
     engine so the ticket shows grade + capacity + fluids automatically —
     no manual lookup. Loaded on demand, only when it's actually needed. */
  const draftVehicle = draft ? shop.vehicles[draft.vehicleId] : null;
  const draftShopSpec = draftVehicle ? (findSpec(shop.specs, draftVehicle) || {}).spec : null;
  const [vvData, setVvData] = useState(null);
  const needVv = !!draftVehicle && !draftShopSpec && !vvData;
  useEffect(() => {
    if (!needVv) return undefined;
    let ok = true;
    loadValvolineSpecs().then((d) => ok && setVvData(d)).catch(() => {});
    return () => { ok = false; };
  }, [needVv]);
  const vvSpec = useMemo(
    () => (draftVehicle && !draftShopSpec && vvData ? findValvolineSpec(vvData, draftVehicle) : null),
    [draftVehicle, draftShopSpec, vvData]
  );

  /* adopt changes from another device only when we have nothing unsaved */
  useEffect(() => {
    if (order && !dirty.current && order.updatedAt > ((draftRef.current && draftRef.current.updatedAt) || 0)) {
      draftRef.current = order;
      setDraft(order);
    }
  }, [order]);

  const flushNow = useCallback(async () => {
    clearTimeout(timer.current);
    if (!dirty.current) return draftRef.current;
    dirty.current = false;
    return saveRef.current(draftRef.current);
  }, []);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (dirty.current) {
        dirty.current = false;
        saveRef.current(draftRef.current);
      }
    },
    []
  );
  const update = useCallback(
    (patch) => {
      const cur = draftRef.current;
      let next = typeof patch === "function" ? patch(cur) : { ...cur, ...patch };
      /* when the ticket's lines change, keep a filled checklist in step:
         a service added flips its item to Replaced, a service removed puts
         it back where it was */
      if (next.lines !== cur.lines && next.checklist && next.checklist.items) {
        const items = syncChecklist(next.checklist.items, next.lines, cfg.checklist, shop.parts);
        if (items !== next.checklist.items) next = { ...next, checklist: { ...next.checklist, items } };
      }
      draftRef.current = next;
      dirty.current = true;
      setDraft(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(flushNow, 600);
    },
    [flushNow, cfg.checklist, shop.parts]
  );

  /* A parts cart sent back by a catalog lands as its own record; when
     one names this ticket, its parts go on as lines. */
  const applyCart = useCallback(
    async (key) => {
      const cart = await sGet(key, null);
      if (!cart || cart.applied || cart.orderId !== orderId) return;
      const lines = cartToLines(cart, cfg, uid);
      if (lines.length) update((d) => ({ ...d, lines: [...d.lines, ...lines] }));
      await sSet(key, { ...cart, applied: true, appliedAt: Date.now() });
      flash(`${lines.length} part${lines.length === 1 ? "" : "s"} added from ${cart.supplier || cart.source || "the catalog"}`);
    },
    [orderId, cfg, update, flash]
  );
  useEffect(() => {
    sList(CART_PREFIX).then((keys) => keys.forEach(applyCart));
    return cloud.subscribe((e) => {
      if (e.type !== "data") return;
      for (const k of e.keys || []) if (k.startsWith(CART_PREFIX)) applyCart(k);
    });
  }, [applyCart]);

  const openCatalog = async (key, url) => {
    await flushNow();
    const v = vehicle;
    const text = v && v.vin ? v.vin : v && v.plate ? v.plate : "";
    if (text && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        flash(`${v.vin ? "VIN" : "Plate"} ${text} copied — paste it into the catalog's vehicle search`);
      } catch {
        /* clipboard blocked; the catalog still opens */
      }
    }
    window.open(url, "catalog-" + key, "noopener");
  };

  if (!draft)
    return (
      <div className="deskBody">
        <p className="emptyNote">That ticket isn't on this device.</p>
      </div>
    );

  const o = draft;
  const customer = shop.customers[o.customerId];
  const vehicle = shop.vehicles[o.vehicleId];
  const vehicles = o.customerId ? vehiclesOf(shop.vehicles, o.customerId) : [];
  /* the shop's own spec if entered, otherwise Valvoline's — so the oil
     change prefills quarts and grade either way */
  const shopSpec = vehicle ? (findSpec(shop.specs, vehicle) || {}).spec : null;
  const effSpec =
    shopSpec ||
    (vvSpec ? { year: vehicle.year, make: vehicle.make, model: vehicle.model, engine: vehicle.engine, oilViscosity: vvSpec.grade, oilCapacityQt: vvSpec.qt, oilFilters: [] } : null);
  const t = orderTotals(o, cfg, customer);
  const rules = rulesFor(o, cfg, customer);
  const locked = o.status === STATUS.invoiced || o.status === STATUS.void || o.status === STATUS.deleted;
  const techs = employees.filter((e) => e.active !== false);
  const payout = orderPayout(o, shop.jobs, cfg.oilPackages, cfg.commission && cfg.commission.split);
  /* the tire size this car was last sold, so the rack opens on it */
  const lastTireSize = (() => {
    if (!o.vehicleId) return "";
    const prior = Object.values(shop.orders)
      .filter((x) => x.vehicleId === o.vehicleId && x.id !== o.id && x.status !== "deleted")
      .sort((a, b) => (b.invoicedAt || b.createdAt) - (a.invoicedAt || a.createdAt));
    for (const x of prior)
      for (const l of x.lines || []) {
        const part = l.partId && shop.parts[l.partId];
        if (part && part.tire && part.size) return part.size;
      }
    return "";
  })();

  /* ---------- lines ---------- */
  const addLine = (kind, extra) => update((d) => ({ ...d, lines: [...d.lines, makeLine(kind, cfg, { id: uid(), ...extra })] }));
  const addLines = (lines) => update((d) => ({ ...d, lines: [...d.lines, ...lines] }));
  const setLine = (id, patch) => update((d) => ({ ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  const removeLine = (id) => update((d) => ({ ...d, lines: d.lines.filter((l) => l.id !== id) }));
  /* remove every line that belongs to one job/package in a single click */
  const removeJob = (jobName) => update((d) => ({ ...d, lines: d.lines.filter((l) => (l.job || "") !== jobName) }));
  const clearLines = () => {
    if (!o.lines.length) return;
    if (window.confirm("Remove every line from this ticket? This can't be undone.")) update((d) => ({ ...d, lines: [] }));
  };

  /* When the ticket already has a car with no owner (the plate-first
     flow), the customer becomes that car's owner. Otherwise their cars
     come up to choose from. */
  const pickCustomer = async (c) => {
    setPick(null);
    if (vehicle && !vehicle.customerId) {
      await shop.saveVehicle({ ...vehicle, customerId: c.id });
      update({ customerId: c.id });
      return;
    }
    if (vehicle && vehicle.customerId === c.id) {
      update({ customerId: c.id });
      return;
    }
    const vehs = vehiclesOf(shop.vehicles, c.id);
    const v = vehs.length === 1 ? vehs[0] : null;
    update({ customerId: c.id, vehicleId: v ? v.id : o.vehicleId || null });
    if (!vehs.length && !vehicle) setVehEdit({});
  };
  /* Mileage is entered fresh at the counter, so choosing a car doesn't
     prefill it from the car's last visit. */
  const pickVehicle = (id) => {
    update((d) => ({ ...d, vehicleId: id || null }));
  };

  /* ---------- status ---------- */
  const moveTo = async (to) => {
    const latest = await flushNow();
    /* an oil change can't be posted until the crew is recorded — set it on
       the reminder-sticker screen or in Details */
    if (to === STATUS.invoiced && hasOilChange(latest) && !crewAssigned(latest)) {
      setSticker({ id: latest.id });
      return flash("Assign the advisor, top tech, and pit tech before posting an oil change.", "out");
    }
    try {
      const saved = await shop.setStatus(latest, to, customer);
      draftRef.current = saved;
      setDraft(saved);
      /* run the service checklist when an oil change ticket moves to a
         repair order or gets posted, if one hasn't been done yet — but not
         when reopening a posted invoice to fix it (that's a correction) */
      const reopening = latest.status === STATUS.invoiced && to === STATUS.open;
      const oilOnTicket = hasOilChange(saved);
      const needsChecklist =
        !reopening && oilOnTicket && !saved.checklist && cfg.checklistOnOil !== false && (to === STATUS.open || to === STATUS.invoiced);
      /* the reminder sticker pops on both a repair order and a post */
      const stickerNow = !reopening && (to === STATUS.open || to === STATUS.invoiced) && oilOnTicket && cfg.oilSticker !== false;
      if (needsChecklist) {
        setPick("checklist");
        /* the sticker also pops here — hold it until the checklist is
           filled so the two don't fight over the screen */
        stickerAfterChecklist.current = stickerNow ? { id: saved.id } : null;
      } else {
        setPick(null);
        if (stickerNow) setSticker({ id: saved.id });
      }
      flash(
        to === STATUS.invoiced
          ? `Invoice #${saved.number} posted`
          : to === STATUS.open
          ? reopening
            ? `Invoice #${saved.number} reopened to a repair order`
            : `RO #${saved.number} approved`
          : to === STATUS.void
          ? `Invoice #${saved.number} voided`
          : `Back to estimate`,
        to === STATUS.void ? "out" : "in"
      );
    } catch (e) {
      flash(e.message, "out");
    }
  };
  /* Close the checklist modal, and if posting left a reminder sticker
     waiting behind it, print it now. */
  const closeChecklist = () => {
    setPick(null);
    const s = stickerAfterChecklist.current;
    stickerAfterChecklist.current = null;
    if (s) setSticker(s);
  };
  const askPost = () => {
    if (!o.lines.some((l) => l.kind !== "note")) return flash("Nothing on the ticket yet", "out");
    setPick("confirmPost");
  };

  const addPayment = async (p) => {
    const at = Date.now();
    update((d) => {
      const payments = [...(d.payments || []), { ...p, id: uid(), at }];
      const bal = orderTotals({ ...d, payments }, cfg, customer).balance;
      return {
        ...d,
        payments,
        paidAt: d.status === STATUS.invoiced && bal <= 0.001 ? at : d.paidAt || null,
        history: [...(d.history || []), { at, what: `paid ${p.method} ${toNum(p.amount).toFixed(2)}` }],
      };
    });
    await flushNow();
    setPick(null);
    flash("Payment recorded");
  };
  const removePayment = (id) =>
    update((d) => ({
      ...d,
      payments: d.payments.filter((p) => p.id !== id),
      paidAt: null,
      history: [...(d.history || []), { at: Date.now(), what: "payment removed" }],
    }));

  const writerName = (id) => (employees.find((e) => e.id === id) || {}).name;

  return (
    <>
      <header className="deskHead">
        <button className="btn ghost" onClick={() => nav.go("orders")}>
          ← Tickets
        </button>
        <h1>{orderTitle(o)}</h1>
        <span className={`st ${o.status}`}>{statusLabel(o.status)}</span>
        {o.status === STATUS.invoiced && (owesBalance(o, t) ? <span className="st due">Balance due</span> : <span className="st paid">Paid</span>)}
        <div className="grow" />
        <div className="tkActions">
          {!locked && !customer && (
            <button className="btn primary" onClick={() => setPick("customer")}>
              + Customer
            </button>
          )}
          <button className="btn" onClick={async () => (await flushNow(), nav.print(o.id))}>
            Print
          </button>
          <button className="btn" onClick={async () => (await flushNow(), setShowRevs(true))} title="Snapshots of this ticket over time">
            Revisions{revisionCount(o) ? ` (${revisionCount(o)})` : ""}
          </button>
          {hasOilChange(o) && (
            <button className="btn" onClick={() => setSticker({ id: o.id })} title="Print the oil-change reminder sticker">
              Sticker
            </button>
          )}
          {(o.status === STATUS.estimate || o.status === STATUS.open || o.status === STATUS.invoiced) && (customer || vehicle) && (
            <>
              <button className="btn" onClick={async () => (await flushNow(), setSigning(true))}>
                Get signature
              </button>
              {customer && (
                <button
                  className="btn"
                  title="Text the customer a link to review and sign — for when they left the car"
                  onClick={async () => {
                    const phone = String((customer && customer.phone) || "").replace(/\D/g, "");
                    if (phone.length < 10) return flash("Add a cell number to the customer first.", "out");
                    await flushNow();
                    const isInvoice = o.status === STATUS.invoiced || o.status === STATUS.void;
                    const slot = isInvoice ? "delivery" : "authorization";
                    const payload = {
                      kind: isInvoice ? "invoice" : "estimate",
                      number: o.number,
                      dateText: fmtDate(o.invoicedAt || o.createdAt),
                      shopName: cfg.shopName,
                      shopAddress: cfg.shopAddress,
                      shopPhone: cfg.shopPhone,
                      customerName: customerName(customer),
                      customerPhone: fmtPhone(customer.phone),
                      vehicleName: vehicleName(vehicle),
                      vehicleSub: vehicle ? [vehicle.engine, vehicle.plate].filter(Boolean).join(" · ") : "",
                      concern: o.concern || "",
                      lines: (o.lines || [])
                        .filter((l) => l.kind !== "note" || l.description)
                        .map((l) => ({
                          label: (l.job && l.job !== l.description ? l.job + ": " : "") + (l.description || l.job || l.kind),
                          sub: l.kind === "labor" ? `${l.hours || 0} hr` : l.kind === "part" && Number(l.qty) > 1 ? `× ${l.qty}` : "",
                          amount: lineAmount(l),
                          discount: l.kind === "discount",
                        })),
                      subtotal: t.subtotal,
                      taxLabel: `Sales tax${t.taxRate ? ` (${t.taxRate}%)` : ""}`,
                      tax: t.tax,
                      total: t.total,
                      balance: isInvoice && owesBalance(o, t) ? t.balance : 0,
                      statement: isInvoice ? cfg.invoiceFooter || "" : cfg.authorizationText || "",
                      heading: isInvoice ? "Please review and sign for your vehicle" : "Please review and approve this estimate",
                    };
                    try {
                      const res = await cloud.invoke("sign", { action: "create", orderId: o.id, slot, phone: customer.phone, payload });
                      if (res && res.sent) flash("Texted to the customer to sign.");
                      else if (res && res.link) {
                        try {
                          await navigator.clipboard.writeText(res.link);
                        } catch {
                          /* clipboard blocked */
                        }
                        flash("Texting isn't set up yet — link copied, paste it to the customer.", "out");
                      } else flash("Couldn't send.", "out");
                    } catch (e) {
                      console.error("text to sign failed", e);
                      flash("Couldn't send — the shop must be online and set up for texting.", "out");
                    }
                  }}
                >
                  Text to sign
                </button>
              )}
              <button
                className="btn"
                onClick={async () => {
                  await flushNow();
                  await sSet(SIGNREQ_KEY, { orderId: o.id, at: Date.now() });
                  flash("Sent to the signature pad");
                }}
                title="Show this on a tablet running the Signature pad"
              >
                Send to pad
              </button>
              {customer && (
                <button
                  className="btn"
                  onClick={async () => {
                    await sSet(INFOREQ_KEY, { customerId: customer.id, at: Date.now() });
                    flash("Sent the info form to the tablet");
                  }}
                  title="Ask the customer to verify or update their contact info on the tablet"
                >
                  Verify info
                </button>
              )}
              {customer && (
                <button className="btn" onClick={() => setShowQR(true)} title="Show the customer a QR to their receipts in the portal">
                  Receipt QR
                </button>
              )}
            </>
          )}
          {o.status === STATUS.estimate && (
            <button className="btn" onClick={() => moveTo(STATUS.open)}>
              Approve → Repair order
            </button>
          )}
          {o.status === STATUS.open && (
            <button className="btn ghost" onClick={() => moveTo(STATUS.estimate)}>
              Back to estimate
            </button>
          )}
          {(o.status === STATUS.estimate || o.status === STATUS.open) && (
            <button className="btn primary" onClick={askPost}>
              Post invoice
            </button>
          )}
          {o.status !== STATUS.void && o.status !== STATUS.estimate && owesBalance(o, t) && (
            <button className="btn primary" onClick={() => setPick("pay")}>
              Take payment
            </button>
          )}
          {o.status === STATUS.invoiced && (
            <button className="btn" onClick={() => setPick("coupon")} title="Apply a coupon the customer showed at the counter">
              Add coupon
            </button>
          )}
          {o.status === STATUS.invoiced && (
            <button className="btn ghost" onClick={() => setPick("confirmReopen")} title="Reopen this invoice to a repair order to fix it, then post again">
              Back to repair order
            </button>
          )}
          {o.status === STATUS.invoiced && (
            <button className="btn danger" onClick={() => setPick("confirmVoid")}>
              Void
            </button>
          )}
          {(o.status === STATUS.estimate || o.status === STATUS.open || o.status === STATUS.void) && (
            <button className="btn danger" onClick={() => setPick("confirmDelete")} title={o.status === STATUS.void ? "Remove this voided receipt from the lists" : undefined}>
              Delete
            </button>
          )}
        </div>
      </header>

      <div className={`deskBody tk ${locked ? "readonly" : ""}`}>
        <div>
          {locked && (
            <div className="warnBox" style={{ marginBottom: 14 }}>
              {o.status === STATUS.deleted
                ? `This ticket was deleted ${fmtDateTime(o.deletedAt)}.`
                : o.status === STATUS.void
                ? `This invoice was voided ${fmtDateTime(o.voidedAt)}. It stays on file; nothing on it can change.`
                : `Posted ${fmtDateTime(o.invoicedAt)}. Lines are locked, but you can still add a coupon. To change anything else, use Back to repair order, fix it, and post again — the number stays the same.`}
            </div>
          )}

          <div className="tkWho">
            <div className="card">
              {customer ? (
                <>
                  <div className="cardHead">
                    <h3>Customer</h3>
                    {!locked && (
                      <span className="rowBtns">
                        <button className="btn tiny" onClick={() => setCustEdit(true)}>
                          Edit
                        </button>
                        <button className="btn tiny" onClick={() => setPick("customer")}>
                          Change
                        </button>
                      </span>
                    )}
                  </div>
                  <div className="whoName">
                    <button className="linkish" style={{ color: "inherit", textDecoration: "none" }} onClick={() => nav.openCustomer(customer.id)}>
                      {customerName(customer)}
                    </button>
                  </div>
                  <div className="whoSub">
                    {[customer.company && customer.first ? customer.company : "", fmtPhone(customer.phone), customer.email].filter(Boolean).join(" · ")}
                    {customer.taxExempt ? " · Tax exempt" : ""}
                    {customer.notes ? <div style={{ color: "var(--signal)" }}>{customer.notes}</div> : null}
                  </div>
                </>
              ) : (
                <button className="pick" onClick={() => setPick("customer")} disabled={locked}>
                  + Add the customer when they're ready
                </button>
              )}
            </div>
            <div className="card">
              <div className="cardHead">
                <h3>Vehicle</h3>
                {!locked && (
                  <span className="rowBtns">
                    {vehicle && (
                      <button className="btn tiny" onClick={() => setVehEdit(vehicle)}>
                        Edit
                      </button>
                    )}
                    <button className="btn tiny" onClick={() => setVehEdit({})}>
                      {vehicle ? "Different car" : "Add car"}
                    </button>
                  </span>
                )}
              </div>
              {!o.customerId && !vehicle ? (
                <p className="muted" style={{ margin: 0 }}>
                  No car on this ticket.
                </p>
              ) : (
                <>
                  {vehicles.length > 1 && !locked && (
                    <select className="search" style={{ width: "100%", marginBottom: 10, minWidth: 0 }} value={o.vehicleId || ""} onChange={(e) => pickVehicle(e.target.value)}>
                      <option value="">— which vehicle? —</option>
                      {vehicles.map((v) => (
                        <option key={v.id} value={v.id}>
                          {vehicleName(v)} {v.plate ? `· ${v.plate}` : ""}
                        </option>
                      ))}
                    </select>
                  )}
                  {vehicle ? (
                    <>
                      <div className="whoName">{vehicleName(vehicle)}</div>
                      <div className="whoSub">
                        {[vehicle.engine, vehicle.color, vehicle.plate, vehicle.vin].filter(Boolean).join(" · ")}
                        {vehicle.notes ? <div style={{ color: "var(--signal)" }}>{vehicle.notes}</div> : null}
                      </div>
                    </>
                  ) : (
                    <p className="muted" style={{ margin: 0 }}>
                      {vehicles.length ? "Choose one above." : "No vehicles on file — add one."}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          {vehicle && (
            <SpecsCard
              vehicle={vehicle}
              shop={shop}
              cfg={cfg}
              locked={locked}
              vvSpec={vvSpec}
              onEdit={() => setSpecEdit(true)}
              onAdd={() => setPick("oil")}
            />
          )}

          <div className="card" style={{ marginTop: 14 }}>
            {!locked && (
              <div className="addBar">
                {(cfg.serviceMenu || []).map((m) => (
                  <button
                    key={m.id}
                    className={`btn tiny ${m.color === "green" ? "menuGreen" : "menuRed"}`}
                    onClick={() => {
                      if (m.oil) return setPick("oil");
                      const pc = menuPartCat(m);
                      if (pc) {
                        setPartCat(pc);
                        return setPick("part");
                      }
                      setJobCat(m.category || m.name);
                      setPick("job");
                    }}
                  >
                    {m.name}
                  </button>
                ))}
                <button
                  className="btn tiny ghost"
                  onClick={() => {
                    setJobCat("");
                    setPick("job");
                  }}
                  title="Every canned job, whatever its category"
                >
                  All jobs
                </button>
              </div>
            )}
            {!locked && (
              <div className="addBar" style={{ paddingTop: 6, marginBottom: 14 }}>
                {CATALOGS.filter(([k]) => cfg.catalogs && cfg.catalogs[k]).map(([k, label, url]) => (
                  <button key={k} className="btn tiny" onClick={() => openCatalog(k, url)} title={`Open ${label} in a new tab`}>
                    {label} ↗
                  </button>
                ))}
                <button
                  className="btn tiny"
                  onClick={() => {
                    setPartCat("");
                    setPick("part");
                  }}
                >
                  + Part
                </button>
                <button className="btn tiny" onClick={() => addLine("labor", { techId: o.topTechId || o.techId || null })}>
                  + Labor
                </button>
                <button className="btn tiny" onClick={() => addLine("sublet")}>
                  + Sublet
                </button>
                <button className="btn tiny" onClick={() => addLine("fee")}>
                  + Fee
                </button>
                <button className="btn tiny" onClick={() => setPick("coupon")}>
                  Coupon
                </button>
                <button className="btn tiny" onClick={() => addLine("note")}>
                  + Note
                </button>
                <button className="btn tiny" onClick={() => setPick("checklist")} title="The walk-around checklist, filled from the keyboard">
                  Checklist
                </button>
                {o.lines.length > 0 && (
                  <button className="btn tiny danger" style={{ marginLeft: "auto" }} onClick={clearLines} title="Remove every line and start over">
                    Clear all
                  </button>
                )}
              </div>
            )}
            <div className="cardHead" style={{ marginBottom: 6 }}>
              <h3 style={{ fontSize: 14 }}>Customer states (prints on the ticket)</h3>
              {!locked && (
                <button className="btn tiny" onClick={() => setPick("symptom")}>
                  + Common symptom
                </button>
              )}
            </div>
            <textarea
              className="ta"
              value={o.concern || ""}
              onChange={(e) => update({ concern: e.target.value })}
              placeholder="Grinding noise from the front when braking…"
              readOnly={locked}
            />

            <div className="tkLines">
              <table className="lines">
                <thead>
                  <tr>
                    <th style={{ width: 70 }}>Type</th>
                    <th style={{ width: 150 }}>Part # / Tech</th>
                    <th>Description</th>
                    <th className="r" style={{ width: 80 }}>
                      Qty / Hrs
                    </th>
                    <th className="r" style={{ width: 100 }}>
                      Each / Rate
                    </th>
                    <th style={{ width: 44, textAlign: "center" }}>Tax</th>
                    <th className="r" style={{ width: 100 }}>
                      Amount
                    </th>
                    <th style={{ width: 36 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {o.lines.length === 0 && (
                    <tr>
                      <td colSpan={8} className="emptyNote">
                        Nothing on the ticket yet. Add a canned job, a part, or labor below.
                      </td>
                    </tr>
                  )}
                  {o.lines.map((l, i) => (
                    <LineRow
                      key={l.id}
                      l={l}
                      prev={o.lines[i - 1]}
                      rules={rules}
                      techs={techs}
                      locked={locked}
                      set={(patch) => setLine(l.id, patch)}
                      remove={() => removeLine(l.id)}
                      removeJob={removeJob}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <VisitHistory shop={shop} order={o} vehicle={vehicle} customer={customer} nav={nav} />
        </div>

        <div className="stack">
          <div className="card">
            <div className="totals">
              <div>
                <span>Parts</span>
                <Money v={t.parts} />
              </div>
              <div>
                <span>Labor</span>
                <Money v={t.labor} />
              </div>
              {t.sublet > 0 && (
                <div>
                  <span>Sublet</span>
                  <Money v={t.sublet} />
                </div>
              )}
              {t.fees > 0 && (
                <div>
                  <span>Fees</span>
                  <Money v={t.fees} />
                </div>
              )}
              <div>
                <span>Shop supplies{rules.suppliesPct && !o.noSupplies ? ` (${rules.suppliesPct}% of labor)` : ""}</span>
                <Money v={t.supplies} />
              </div>
              {t.discounts > 0 && (
                <div>
                  <span>Discounts</span>
                  <Money v={-t.discounts} />
                </div>
              )}
              <div>
                <span>
                  Tax {t.taxRate}% on <Money v={t.taxable} />
                </span>
                <Money v={t.tax} />
              </div>
              <div className="grand">
                <span>Total</span>
                <Money v={t.total} />
              </div>
              {t.paid !== 0 && (
                <div>
                  <span>Paid</span>
                  <Money v={-t.paid} />
                </div>
              )}
              {(t.paid !== 0 || o.status === STATUS.invoiced) && (
                <div className={`bal ${owesBalance(o, t) ? "" : "ok"}`}>
                  <span>Balance</span>
                  {owesBalance(o, t) ? <Money v={t.balance} /> : <span>Settled</span>}
                </div>
              )}
            </div>
            {o.status !== STATUS.void && o.status !== STATUS.estimate && (
              <div className="rowBtns" style={{ marginTop: 12 }}>
                <button className="btn tiny primary" onClick={() => setPick("pay")}>
                  {o.status === STATUS.open ? "Take deposit" : "Take payment"}
                </button>
              </div>
            )}
            {(o.payments || []).length > 0 && (
              <ul className="payList" style={{ marginTop: 12 }}>
                {o.payments.map((p) => (
                  <li key={p.id}>
                    <span>
                      {p.method}
                      {p.ref ? ` · ${p.ref}` : ""} · {fmtDateTime(p.at)}
                    </span>
                    <span>
                      <Money v={p.amount} />
                      {o.status !== STATUS.void && (
                        <button className="lineX" title="Remove this payment" onClick={() => removePayment(p.id)}>
                          ✕
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card">
            <div className="cardHead">
              <h3>Details</h3>
            </div>
            <div className="fldRow">
              <Field label="Advisor (computer, upsell)">
                <select value={o.advisorId || o.writerId || ""} onChange={(e) => update({ advisorId: e.target.value || null, writerId: e.target.value || null })} disabled={locked}>
                  <option value="">—</option>
                  {techs.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Top tech (hood)">
                <select value={o.topTechId || o.techId || ""} onChange={(e) => update({ topTechId: e.target.value || null, techId: e.target.value || null })} disabled={locked}>
                  <option value="">—</option>
                  {techs.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Pit tech (under car)">
                <select value={o.pitTechId || ""} onChange={(e) => update({ pitTechId: e.target.value || null })} disabled={locked}>
                  <option value="">—</option>
                  {techs.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {payout.total > 0 && (
              <p className="commReadout">
                Commission on this ticket: <strong>{fmtMoney(payout.total)}</strong>
                <span className="muted">
                  {" "}
                  — Advisor {fmtMoney(payout.advisor)} · Top {fmtMoney(payout.top)} · Pit {fmtMoney(payout.pit)}
                </span>
              </p>
            )}
            <div className="fldRow">
              <Field label="Mileage in">
                <Num value={o.mileageIn} onChange={(v) => update({ mileageIn: v })} readOnly={locked} />
              </Field>
              <Field label="Mileage out">
                <Num value={o.mileageOut} onChange={(v) => update({ mileageOut: v })} readOnly={locked} />
              </Field>
            </div>
            <label className="fld inline">
              <input type="checkbox" checked={!!o.noSupplies} onChange={(e) => update({ noSupplies: e.target.checked })} disabled={locked} />
              <span>No shop supplies charge on this ticket</span>
            </label>
            <Field label="Internal notes (never printed)">
              <textarea className="ta" value={o.notes || ""} onChange={(e) => update({ notes: e.target.value })} readOnly={locked} />
            </Field>
          </div>

          <ChecklistCard order={o} locked={locked} onOpen={() => setPick("checklist")} />

          <div className="card">
            <div className="cardHead">
              <h3>History</h3>
            </div>
            <ul className="histList">
              {(o.history || []).map((h, i) => (
                <li key={i}>
                  {fmtDateTime(h.at)} — {h.what}
                </li>
              ))}
              {o.writerId && <li>Writer: {writerName(o.writerId)}</li>}
            </ul>
          </div>
        </div>
      </div>

      {pick === "customer" && <CustomerPicker shop={shop} cfg={cfg} onPick={pickCustomer} onClose={() => setPick(null)} />}
      {signing && <OrderSign order={o} shop={shop} cfg={cfg} flash={flash} onDone={() => setSigning(false)} />}
      {showQR && <PortalQR customer={customer} onClose={() => setShowQR(false)} />}
      {sticker && shop.orders[sticker.id] && (
        <Sticker
          order={shop.orders[sticker.id]}
          cfg={cfg}
          vehicle={shop.vehicles[shop.orders[sticker.id].vehicleId]}
          employees={techs}
          requireCrew={hasOilChange(shop.orders[sticker.id])}
          onAssign={(patch) => update((dd) => (dd.id === sticker.id ? { ...dd, ...patch } : dd))}
          onClose={() => setSticker(null)}
          onSave={({ months, miles, mileage }) => {
            const ord = shop.orders[sticker.id];
            const v = ord && shop.vehicles[ord.vehicleId];
            /* remember the interval on the car so its next visit defaults to it */
            if (v) shop.saveVehicle({ ...v, reminderMonths: months || null, reminderMiles: miles || null });
            /* record the mileage on this ticket if it had none */
            if (mileage && ord && !ord.mileageOut && !ord.mileageIn) update((dd) => (dd.id === ord.id ? { ...dd, mileageOut: mileage } : dd));
          }}
        />
      )}
      {showRevs && (
        <RevisionsModal
          order={o}
          onClose={() => setShowRevs(false)}
          onSave={(note) => {
            update((d) => withRevision(d, makeRevision(d, cfg, customer, note)));
            flash("Revision saved");
          }}
        />
      )}
      {specEdit && vehicle && (
        <SpecForm
          vehicle={vehicle}
          initial={(findSpec(shop.specs, vehicle) || {}).spec}
          onClose={() => setSpecEdit(false)}
          onSave={async (sp) => {
            await shop.saveSpec(sp);
            setSpecEdit(false);
            flash("Specs saved for this engine");
          }}
        />
      )}
      {custEdit && customer && (
        <CustomerForm
          initial={customer}
          cfg={cfg}
          onClose={() => setCustEdit(false)}
          onSave={async (c) => {
            await shop.saveCustomer(c);
            setCustEdit(false);
          }}
        />
      )}
      {vehEdit && (
        <VehicleForm
          cfg={cfg}
          shop={shop}
          initial={vehEdit.id ? vehEdit : null}
          customerId={o.customerId || null}
          onClose={() => setVehEdit(null)}
          onSave={async (v) => {
            const saved = await shop.saveVehicle(v);
            setVehEdit(null);
            if (!vehEdit.id || o.vehicleId === saved.id) pickVehicle(saved.id, saved);
          }}
        />
      )}
      {pick === "part" && (
        <PartPicker
          shop={shop}
          category={partCat}
          onClose={() => setPick(null)}
          onPick={(p) => {
            addLine("part", {
              partId: p.id,
              number: p.number,
              description: p.tire && p.size && !String(p.description || "").includes(p.size) ? `${p.description} ${p.size}`.trim() : p.description,
              price: toNum(p.price),
              cost: toNum(p.cost),
              taxable: p.taxable === false ? false : null,
            });
            setPick(null);
          }}
          onTyped={(text) => {
            addLine("part", { description: text });
            setPick(null);
          }}
        />
      )}
      {pick === "coupon" && (
        <CouponPicker
          shop={shop}
          order={o}
          onClose={() => setPick(null)}
          onApply={(coupon, amount) => {
            addLine("discount", { description: coupon.name || coupon.code, qty: 1, price: amount, couponId: coupon.id, couponCode: coupon.code });
            setPick(null);
            flash(`${coupon.code} applied`);
          }}
        />
      )}
      {pick === "symptom" && (
        <SymptomPicker
          cfg={cfg}
          onClose={() => setPick(null)}
          onPick={(text) => update((d) => ({ ...d, concern: addSymptom(d.concern, text) }))}
        />
      )}
      {pick === "oil" && (
        <OilChangePicker
          cfg={cfg}
          shop={shop}
          spec={effSpec}
          onClose={() => setPick(null)}
          onAdd={(lines, pkg) => {
            addLines(lines.map((l) => (l.kind === "labor" ? { ...l, techId: o.topTechId || o.techId || null } : l)));
            /* on a repair order, run the checklist right away; on an estimate it waits until the RO is approved */
            setPick(o.status === STATUS.open && !o.checklist && cfg.checklistOnOil !== false ? "checklist" : null);
            flash(`${pkg.name} added`);
          }}
        />
      )}
      {pick === "job" && (
        <JobPicker
          shop={shop}
          cfg={cfg}
          category={jobCat}
          lastTireSize={lastTireSize}
          onClose={() => setPick(null)}
          onPick={(j, count, tire) => {
            let lines = jobLines(j, cfg, shop.parts, uid, count).map((l) => (l.kind === "labor" ? { ...l, techId: o.topTechId || o.techId || null } : l));
            if (tire) {
              /* the chosen tire becomes the job's tire line: replaces a
                 placeholder "Tire" part with no inventory link, else is added */
              const tireLine = makeLine("part", cfg, {
                id: uid(),
                job: j.name,
                partId: tire.id,
                number: tire.number || "",
                description: `${tireName(tire)} ${tire.size}`.trim(),
                qty: count,
                price: toNum(tire.price),
                cost: toNum(tire.cost),
                condition: /used/i.test(j.name) ? "used" : "new",
                taxable: tire.taxable === false ? false : null,
              });
              const i = lines.findIndex((l) => l.kind === "part" && !l.partId && /tire/i.test(l.description || ""));
              if (i >= 0) lines[i] = tireLine;
              else lines = [tireLine, ...lines];
            }
            addLines(lines);
            setPick(null);
          }}
        />
      )}
      {pick === "checklist" && (
        <ChecklistModal
          cfg={cfg}
          order={o}
          parts={shop.parts}
          prior={priorChecklist(shop.orders, o.vehicleId, o.id)}
          onCancel={closeChecklist}
          onSave={(items) => {
            const at = Date.now();
            update((d) => ({
              ...d,
              checklist: { at, byId: d.techId || null, items },
              history: d.checklist ? d.history : [...(d.history || []), { at, what: "service checklist filled" }],
            }));
            closeChecklist();
            flash("Checklist saved");
          }}
        />
      )}
      {pick === "pay" && <PaymentModal balance={t.balance} onClose={() => setPick(null)} onSave={addPayment} />}
      {pick === "confirmPost" && (
        <Modal title={`Post invoice #${o.number}?`} onClose={() => setPick(null)}>
          <p className="muted" style={{ lineHeight: 1.5 }}>
            Total <Money v={t.total} className="num" /> for {customerName(customer)}. Inventory parts come off the shelf, the
            tax rate is locked, and the lines can't change after this. Estimates and repair orders can still be edited — post
            when the work is done.
          </p>
          {!o.customerId && <p className="fldErr">No customer on this ticket. It will post as a walk-in.</p>}
          <div className="rowBtns" style={{ marginTop: 10 }}>
            <button className="btn primary lg" onClick={() => moveTo(STATUS.invoiced)}>
              Post invoice
            </button>
            <button className="btn lg" onClick={() => setPick(null)}>
              Not yet
            </button>
          </div>
        </Modal>
      )}
      {pick === "confirmDelete" && (
        <ConfirmDelete
          order={o}
          onClose={() => setPick(null)}
          onConfirm={async () => {
            const latest = await flushNow();
            await shop.setStatus(latest, STATUS.deleted, customer);
            flash(`Ticket #${o.number} deleted`, "out");
            nav.go("orders");
          }}
        />
      )}
      {pick === "confirmVoid" && (
        <Modal title={`Void invoice #${o.number}?`} onClose={() => setPick(null)}>
          <p className="muted" style={{ lineHeight: 1.5 }}>
            The invoice stays on file marked void, parts go back into inventory, and it drops out of sales reports. Payments
            recorded on it stay listed so you remember to refund them.
          </p>
          <div className="rowBtns" style={{ marginTop: 10 }}>
            <button className="btn danger lg" onClick={() => moveTo(STATUS.void)}>
              Void it
            </button>
            <button className="btn lg" onClick={() => setPick(null)}>
              Keep it
            </button>
          </div>
        </Modal>
      )}
      {pick === "confirmReopen" && (
        <Modal title={`Reopen invoice #${o.number}?`} onClose={() => setPick(null)}>
          <p className="muted" style={{ lineHeight: 1.5 }}>
            This goes back to a repair order so you can change it — add a coupon, fix a line — then post it again. Parts go
            back into inventory until you re-post, and the number stays the same.
            {t.paid > 0 ? " Payments already taken stay on the ticket." : ""}
          </p>
          <div className="rowBtns" style={{ marginTop: 10 }}>
            <button className="btn primary lg" onClick={() => moveTo(STATUS.open)}>
              Back to repair order
            </button>
            <button className="btn lg" onClick={() => setPick(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function LineRow({ l, prev, rules, techs, locked, set, remove, removeJob }) {
  const showJob = l.job && (!prev || prev.job !== l.job);
  const tag = { part: "Part", labor: "Labor", sublet: "Sublet", fee: "Fee", discount: "Discount", note: "Note" }[l.kind];
  const taxable = lineTaxable(l, rules);
  return (
    <>
      {showJob && (
        <tr className="jobHead">
          <td colSpan={8}>
            {l.job}
            {!locked && (
              <button className="jobDel" onClick={() => removeJob(l.job)} title={`Remove the whole ${l.job} in one click`}>
                ✕ Remove
              </button>
            )}
          </td>
        </tr>
      )}
      <tr>
        <td>
          <span className="kindTag">{tag}</span>
          {l.unit ? <span className="kindTag"> / {l.unit}</span> : null}
        </td>
        {l.kind === "note" ? (
          <td colSpan={6}>
            <input value={l.description} onChange={(e) => set({ description: e.target.value })} placeholder="Note to the customer, prints on the ticket" readOnly={locked} />
          </td>
        ) : (
          <>
            <td>
              {l.kind === "part" ? (
                <div className="partCell">
                  <input value={l.number || ""} onChange={(e) => set({ number: e.target.value.toUpperCase() })} placeholder="Part #" readOnly={locked} />
                  <select value={l.condition || "new"} onChange={(e) => set({ condition: e.target.value })} disabled={locked} title="New, used, rebuilt, or reconditioned — printed on the invoice">
                    {PART_CONDITIONS.map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : l.kind === "labor" ? (
                <select value={l.techId || ""} onChange={(e) => set({ techId: e.target.value || null })} disabled={locked}>
                  <option value="">Tech —</option>
                  {techs.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              ) : null}
            </td>
            <td>
              {l.kind === "labor" ? (
                <div className="laborCell">
                  <input value={l.description} onChange={(e) => set({ description: e.target.value })} placeholder="What was done" readOnly={locked} />
                  <input
                    value={l.details || ""}
                    onChange={(e) => set({ details: e.target.value })}
                    placeholder="Details (print under the line)"
                    readOnly={locked}
                    className="details"
                  />
                </div>
              ) : (
                <input value={l.description} onChange={(e) => set({ description: e.target.value })} placeholder="Description" readOnly={locked} />
              )}
            </td>
            <td>
              {l.kind === "labor" ? (
                <input
                  className="r"
                  inputMode="decimal"
                  value={l.hours}
                  onChange={(e) => set({ hours: e.target.value })}
                  onBlur={(e) => set({ hours: toNum(e.target.value) })}
                  readOnly={locked}
                  title={l.unit ? `Number of ${l.unit}s` : "Hours"}
                />
              ) : (
                <input className="r" inputMode="decimal" value={l.qty} onChange={(e) => set({ qty: e.target.value })} onBlur={(e) => set({ qty: toNum(e.target.value) })} readOnly={locked} />
              )}
            </td>
            <td>
              {l.kind === "labor" ? (
                <input className="r" inputMode="decimal" value={l.rate} onChange={(e) => set({ rate: e.target.value })} onBlur={(e) => set({ rate: toNum(e.target.value) })} readOnly={locked} />
              ) : (
                <input className="r" inputMode="decimal" value={l.price} onChange={(e) => set({ price: e.target.value })} onBlur={(e) => set({ price: toNum(e.target.value) })} readOnly={locked || !!l.couponId} title={l.couponId ? "Set by the coupon — remove the line to change it" : undefined} />
              )}
            </td>
            <td className="chk">
              <input type="checkbox" checked={taxable} onChange={(e) => set({ taxable: e.target.checked })} disabled={locked} title={l.kind === "discount" ? "Checked: this discount lowers the taxable amount" : "Taxable"} />
            </td>
            <td className="r lineAmt">{l.kind === "discount" ? "-" : ""}<Money v={lineAmount(l)} /></td>
          </>
        )}
        <td>
          {(!locked || l.kind === "discount") && (
            <button className="lineX" onClick={remove} aria-label="Remove line">
              ✕
            </button>
          )}
        </td>
      </tr>
    </>
  );
}

function PaymentModal({ balance, onClose, onSave }) {
  const [method, setMethod] = useState("card");
  const [amount, setAmount] = useState(balance > 0 ? balance.toFixed(2) : "");
  const [ref, setRef] = useState("");
  const [err, setErr] = useState("");
  return (
    <Modal title="Record a payment" onClose={onClose}>
      <Field label="How">
        <select value={method} onChange={(e) => setMethod(e.target.value)}>
          {PAY_METHODS.map((m) => (
            <option key={m} value={m}>
              {m[0].toUpperCase() + m.slice(1)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Amount">
        <Num value={amount} onChange={setAmount} autoFocus />
      </Field>
      <Field label={method === "check" ? "Check number" : method === "card" ? "Last 4 or approval code" : "Reference (optional)"}>
        <Text value={ref} onChange={setRef} />
      </Field>
      {err && <p className="fldErr">{err}</p>}
      <button
        className="btn primary lg full"
        onClick={() => {
          const a = toNum(amount);
          if (!a) return setErr("Enter an amount. Use a negative number for a refund.");
          onSave({ method, amount: a, ref: ref.trim() });
        }}
      >
        Save payment
      </button>
      <p className="legalNote">Card processing isn't wired in yet — run the card on your terminal and record it here.</p>
    </Modal>
  );
}


/* Oil grade, quarts, filter numbers and Valvoline picks for the car on
   the ticket. Learned once per engine; a licensed feed can fill it later. */
/* Valvoline product names, said the way the counter would. */
const vvShort = (name) =>
  String(name || "")
    .replace(/\s*Motor Oil\s*$/i, "")
    .replace(/\bSAE\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
const vvOilLabel = (name) => "Valvoline " + vvShort(name);

function SpecsCard({ vehicle, shop, cfg, locked, vvSpec, onEdit, onAdd }) {
  const found = findSpec(shop.specs, vehicle);
  const sp = found && found.spec;
  /* Nothing entered by the shop, but Valvoline has this exact engine —
     show it automatically instead of an empty "add specs" prompt. */
  if (!sp && vvSpec)
    return (
      <div className="card specs" style={{ marginTop: 14 }}>
        <div className="cardHead">
          <h3>Service specs <span className="st" style={{ marginLeft: 8 }}>from Valvoline</span></h3>
          {!locked && (
            <span className="rowBtns">
              <button className="btn tiny" onClick={onEdit}>
                Edit
              </button>
              <button className="btn tiny primary" onClick={onAdd}>
                + Oil change
              </button>
            </span>
          )}
        </div>
        <div className="specGrid">
          <div>
            <span>Oil</span>
            <strong>{[vvSpec.grade, vvSpec.qt ? `${vvSpec.qt} qt` : ""].filter(Boolean).join(" · ") || "—"}</strong>
          </div>
          <div>
            <span>{vvSpec.oils.length === 1 ? "Valvoline oil" : "Valvoline oils"}</span>
            <strong>{vvSpec.oils.length ? vvOilLabel(vvSpec.oils[0]) : "—"}</strong>
            {vvSpec.oils.slice(1, 4).map((o) => (
              <em key={o}>{vvOilLabel(o)}</em>
            ))}
            {vvSpec.oils.length > 4 ? <em className="muted">+{vvSpec.oils.length - 4} more</em> : null}
          </div>
        </div>
        {vvSpec.fluids.length > 0 && (
          <div className="fluidGrid" style={{ marginTop: 10 }}>
            {vvSpec.fluids.map((f) => (
              <div key={f.system} style={{ display: "contents" }}>
                <div className="fSys">{f.system}</div>
                <div className="fProd">{f.products.map(vvShort).join(" · ")}</div>
              </div>
            ))}
          </div>
        )}
        <p className="legalNote" style={{ marginTop: 10 }}>
          Valvoline's spec for this {vehicle.year} {vehicle.make} {vehicle.model}
          {vehicle.engine ? ` ${vehicle.engine}` : ""}. Capacity is a guide — confirm on the dipstick. Tap Edit to save your own.
        </p>
      </div>
    );
  if (!sp)
    return (
      <div className="card specs" style={{ marginTop: 14 }}>
        <div className="cardHead">
          <h3>Service specs</h3>
          {!locked && (
            <button className="btn tiny" onClick={onEdit}>
              Add specs for this engine
            </button>
          )}
        </div>
        <p className="muted" style={{ margin: 0 }}>
          No oil grade or capacity on file yet for a {vehicle.year} {vehicle.make} {vehicle.model}
          {vehicle.engine ? ` ${vehicle.engine}` : ""}. Enter it once from the oil cap or the Valvoline guide and it comes up for
          every one of these from now on.
        </p>
      </div>
    );
  const oils = matchOil(shop.parts, sp.oilViscosity);
  const filts = matchFilter(shop.parts, sp.oilFilters);
  const valv = valvolineFor(sp.oilViscosity, sp.oilSpec, vehicle.mileage).slice(0, 3);
  return (
    <div className="card specs" style={{ marginTop: 14 }}>
      <div className="cardHead">
        <h3>
          Service specs
          {!found.exact ? <span className="st" style={{ marginLeft: 8 }}>from a {sp.year}, same engine — double-check</span> : null}
        </h3>
        {!locked && (
          <span className="rowBtns">
            <button className="btn tiny" onClick={onEdit}>
              Edit
            </button>
            <button className="btn tiny primary" onClick={onAdd}>
              + Oil change
            </button>
          </span>
        )}
      </div>
      <div className="specGrid">
        <div>
          <span>Oil</span>
          <strong>
            {sp.oilViscosity} · {sp.oilCapacityQt} qt
          </strong>
          {sp.oilSpec ? <em>{sp.oilSpec}</em> : null}
          {oils.length ? <em className="ok">Stocked: {oils[0].description}</em> : <em className="warn">No {sp.oilViscosity} oil in inventory</em>}
        </div>
        <div>
          <span>Oil filter</span>
          <strong>{(sp.oilFilters || []).map((f) => [f.brand, f.number].filter(Boolean).join(" ")).join(" · ") || "—"}</strong>
          {filts.length ? <em className="ok">Stocked: {filts[0].number}</em> : (sp.oilFilters || []).length ? <em className="warn">Not in inventory</em> : null}
        </div>
        <div>
          <span>Valvoline</span>
          <strong>{valv[0] ? valv[0].product : "—"}</strong>
          {valv.slice(1).map((v) => (
            <em key={v.line}>{v.product}</em>
          ))}
        </div>
        <div>
          <span>Drain plug · reset</span>
          <strong>{sp.drainPlugTorque || "—"}</strong>
          {sp.resetProcedure ? <em>{sp.resetProcedure}</em> : null}
        </div>
      </div>
      {(sp.otherFluids || sp.notes) && (
        <p className="muted" style={{ margin: "10px 0 0", fontSize: 13, whiteSpace: "pre-wrap" }}>
          {[sp.otherFluids, sp.notes].filter(Boolean).join("\n")}
        </p>
      )}
    </div>
  );
}

/* The car's (or, with no car yet, the customer's) last few completed visits:
   date, mileage, and short service codes. A quick read of what's been done
   before, so the desk isn't guessing at service intervals. */
function VisitHistory({ shop, order, vehicle, customer, nav }) {
  const visits = useMemo(() => {
    if (!vehicle && !customer) return [];
    const src = vehicle ? ordersOf(shop.orders, { vehicleId: vehicle.id }) : ordersOf(shop.orders, { customerId: customer.id });
    return src.filter((o) => o.id !== order.id && o.status === STATUS.invoiced).slice(0, 5);
  }, [shop.orders, vehicle, customer, order.id]);

  if (!vehicle && !customer) return null;

  return (
    <div className="card visitHist" style={{ marginTop: 14 }}>
      <div className="cardHead">
        <h3>Recent visits{vehicle ? ` · ${vehicleName(vehicle)}` : ""}</h3>
      </div>
      {visits.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>No prior visits on file.</p>
      ) : (
        <table className="visitTbl">
          <thead>
            <tr>
              <th style={{ width: 110 }}>Date</th>
              <th className="r" style={{ width: 90 }}>Mileage</th>
              <th>Service</th>
            </tr>
          </thead>
          <tbody>
            {visits.map((o) => {
              const miles = o.mileageIn || o.mileageOut;
              const codes = serviceCodes(o, shop.parts);
              return (
                <tr key={o.id} className="visitRow" onClick={() => nav.openOrder(o.id)} title={`Open ticket #${o.number}`}>
                  <td>{fmtDate(o.invoicedAt || o.createdAt)}</td>
                  <td className="r tnum">{miles ? Number(miles).toLocaleString() : "—"}</td>
                  <td className="visitCodes">{codes.length ? codes.join(", ") : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* Quick-fill for "Customer states": tap common complaints to drop them into
   the concern box. Stays open so several can be added. */
function SymptomPicker({ cfg, onClose, onPick }) {
  const groups = symptomGroups(cfg);
  return (
    <Modal title="Common symptoms" onClose={onClose} size="wide">
      <p className="muted" style={{ marginTop: 0 }}>Tap to add to “Customer states.” Add as many as apply, then close.</p>
      {groups.map(([cat, items]) => (
        <div key={cat} className="symGroup">
          <div className="symCat">{cat}</div>
          <div className="symChips">
            {items.map((s) => (
              <button key={s} className="symChip" onClick={() => onPick(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      ))}
    </Modal>
  );
}

/* Revision history: a running record of what the ticket looked like at each
   step, and a box to save a new snapshot with a note about what changed. */
function RevisionsModal({ order, onClose, onSave }) {
  const [note, setNote] = useState("");
  const [openId, setOpenId] = useState(null);
  const revs = [...(order.revisions || [])].reverse(); // newest first
  return (
    <Modal title="Revisions" onClose={onClose} size="wide">
      <div className="revNew">
        <input className="search" style={{ flex: 1 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed? (e.g. added brake flush per customer)" />
        <button
          className="btn primary"
          onClick={() => {
            onSave(note.trim());
            onClose();
          }}
        >
          Save revision
        </button>
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
        A revision saves a snapshot of the ticket exactly as it is now — its lines, totals, and what the customer states — so you have a record of what the customer saw at each step.
      </p>
      {revs.length === 0 ? (
        <p className="emptyNote">No revisions saved yet.</p>
      ) : (
        <div className="revList">
          {revs.map((r, i) => (
            <div key={r.id} className="revItem">
              <button className="revHead" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                <span className="revNo">#{revs.length - i}</span>
                <span className="revWhen">{fmtDateTime(r.at)}</span>
                <span className="revNote">{r.note || <em className="muted">(no note)</em>}</span>
                <span className="revTot">
                  <Money v={r.total} />
                </span>
              </button>
              {openId === r.id && (
                <div className="revLines">
                  {(r.lines || [])
                    .filter((l) => l.kind !== "note" || l.description)
                    .map((l, li) => (
                      <div key={li} className="revLine">
                        <span>
                          {l.description || l.job || l.kind}
                          {l.kind === "labor" && l.hours ? ` · ${l.hours} hr` : ""}
                          {(l.kind === "part" || l.kind === "fee") && Number(l.qty) > 1 ? ` · ${l.qty}` : ""}
                        </span>
                        <span className="r">
                          {l.kind === "discount" ? "-" : ""}
                          <Money v={lineAmount(l)} />
                        </span>
                      </div>
                    ))}
                  {r.concern ? <div className="revConcern">Customer states: {r.concern}</div> : null}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/* The coupon picker: shows only the coupons whose rules fit this ticket right
   now (services on it, first-time customer, date window, minimum), each with
   the exact amount it would take off. There's no free-typed discount. */
function CouponPicker({ shop, order, onClose, onApply }) {
  const cust = shop.customers[order.customerId];
  const priorInvoiced = order.customerId
    ? ordersOf(shop.orders, { customerId: order.customerId }).filter((x) => x.status === "invoiced" && x.id !== order.id).length
    : 0;
  const isFirstTime = !cust || priorInvoiced === 0;
  const already = new Set((order.lines || []).filter((l) => l.kind === "discount" && l.couponId).map((l) => l.couponId));
  const ctx = { jobNames: orderJobNames(order), isFirstTime, subtotal: orderSubtotalBase(order), now: Date.now() };
  const list = applicableCoupons(shop.coupons, ctx)
    .filter((c) => !already.has(c.id))
    .map((c) => ({ c, amount: couponDiscount(c, order) }))
    .filter((x) => x.amount > 0);

  return (
    <Modal title="Apply a coupon" onClose={onClose} size="wide">
      {list.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          No coupons apply to this ticket right now. Coupons are created under the Coupons tab; one shows here only when its rules match what's on the ticket.
        </p>
      ) : (
        <div className="couponList">
          {list.map(({ c, amount }) => (
            <button key={c.id} className="couponRow" onClick={() => onApply(c, amount)}>
              <div className="cpMain">
                <strong>{c.code}</strong>
                <span className="cpVal">{couponValueText(c)}</span>
                <span className="cpAmt">
                  −<Money v={amount} />
                </span>
              </div>
              {c.name ? <div className="cpName muted">{c.name}</div> : null}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
