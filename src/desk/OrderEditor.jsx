import { useState, useEffect, useRef, useCallback } from "react";
import { Modal, Field, Text, Num, Money, fmtDateTime, fmtPhone, toNum } from "./ui.jsx";
import { CustomerForm, CustomerPicker, VehicleForm } from "./forms.jsx";
import { PartPicker, JobPicker } from "./pickers.jsx";
import { ConfirmDelete } from "./Orders.jsx";
import { customerName, vehicleName, vehiclesOf } from "./useShop.js";
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
  PART_CONDITIONS,
} from "../lib/invoice.js";
import { uid } from "../lib/ids.js";
import { CATALOGS, cartToLines } from "../lib/parts.js";
import { findSpec, matchOil, matchFilter } from "../lib/specs.js";
import { valvolineFor } from "../lib/valvoline.js";
import { SpecForm } from "./SpecForm.jsx";
import { OilChangePicker } from "./OilChangePicker.jsx";
import { ChecklistModal, ChecklistCard } from "./ChecklistModal.jsx";
import { priorChecklist } from "../lib/checklist.js";
import { cloud, sGet, sSet, sList } from "../storage/index.js";
import { CART_PREFIX } from "../lib/keys.js";
import { tireName } from "../lib/tires.js";

/* One ticket: estimate → repair order → invoice. Edits save themselves a
   moment after you stop typing. Once posted, the lines lock; only
   payments can change. */

export function OrderEditor({ orderId, shop, cfg, employees, nav, flash }) {
  const order = shop.orders[orderId];
  const [draft, setDraft] = useState(order);
  const draftRef = useRef(order);
  const dirty = useRef(false);
  const timer = useRef(null);
  const saveRef = useRef(shop.saveOrder);
  saveRef.current = shop.saveOrder;
  const [pick, setPick] = useState(null); // customer | part | job | pay | confirm
  const [jobCat, setJobCat] = useState(""); // the menu button that opened the job picker
  const [vehEdit, setVehEdit] = useState(null);
  const [custEdit, setCustEdit] = useState(false);
  const [specEdit, setSpecEdit] = useState(false);

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
      const next = typeof patch === "function" ? patch(cur) : { ...cur, ...patch };
      draftRef.current = next;
      dirty.current = true;
      setDraft(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(flushNow, 600);
    },
    [flushNow]
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
  const t = orderTotals(o, cfg, customer);
  const rules = rulesFor(o, cfg, customer);
  const locked = o.status === STATUS.invoiced || o.status === STATUS.void || o.status === STATUS.deleted;
  const techs = employees.filter((e) => e.active !== false);
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
    update({ customerId: c.id, vehicleId: v ? v.id : o.vehicleId || null, mileageIn: v && v.mileage ? v.mileage : o.mileageIn });
    if (!vehs.length && !vehicle) setVehEdit({});
  };
  /* `veh` is passed when the vehicle was just saved and isn't in the
     rendered shop.vehicles yet */
  const pickVehicle = (id, veh) => {
    const v = veh || shop.vehicles[id];
    update((d) => ({ ...d, vehicleId: id || null, mileageIn: !d.mileageIn && v && v.mileage ? v.mileage : d.mileageIn }));
  };

  /* ---------- status ---------- */
  const moveTo = async (to) => {
    const latest = await flushNow();
    try {
      const saved = await shop.setStatus(latest, to, customer);
      draftRef.current = saved;
      setDraft(saved);
      setPick(null);
      flash(
        to === STATUS.invoiced ? `Invoice #${saved.number} posted` : to === STATUS.open ? `RO #${saved.number} approved` : to === STATUS.void ? `Invoice #${saved.number} voided` : `Back to estimate`,
        to === STATUS.void ? "out" : "in"
      );
    } catch (e) {
      flash(e.message, "out");
    }
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
            <button className="btn danger" onClick={() => setPick("confirmVoid")}>
              Void
            </button>
          )}
          {(o.status === STATUS.estimate || o.status === STATUS.open) && (
            <button className="btn danger" onClick={() => setPick("confirmDelete")}>
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
                : `Posted ${fmtDateTime(o.invoicedAt)}. Lines and totals are locked. To fix a mistake, void it and write a new ticket — the customer's paperwork has this number on it.`}
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
              onEdit={() => setSpecEdit(true)}
              onAdd={() => setPick("oil")}
            />
          )}

          <div className="card" style={{ marginTop: 14 }}>
            <Field label="Customer states (prints on the ticket)">
              <textarea
                className="ta"
                value={o.concern || ""}
                onChange={(e) => update({ concern: e.target.value })}
                placeholder="Grinding noise from the front when braking…"
                readOnly={locked}
              />
            </Field>

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
                    />
                  ))}
                </tbody>
              </table>
              {!locked && (
                <div className="addBar">
                  {(cfg.serviceMenu || []).map((m) => (
                    <button
                      key={m.id}
                      className={`btn tiny ${m.color === "green" ? "menuGreen" : "menuRed"}`}
                      onClick={() => {
                        if (m.oil) return setPick("oil");
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
                <div className="addBar" style={{ paddingTop: 6 }}>
                  {CATALOGS.filter(([k]) => cfg.catalogs && cfg.catalogs[k]).map(([k, label, url]) => (
                    <button key={k} className="btn tiny" onClick={() => openCatalog(k, url)} title={`Open ${label} in a new tab`}>
                      {label} ↗
                    </button>
                  ))}
                  <button className="btn tiny" onClick={() => setPick("part")}>
                    + Part
                  </button>
                  <button className="btn tiny" onClick={() => addLine("labor", { techId: o.techId || null })}>
                    + Labor
                  </button>
                  <button className="btn tiny" onClick={() => addLine("sublet")}>
                    + Sublet
                  </button>
                  <button className="btn tiny" onClick={() => addLine("fee")}>
                    + Fee
                  </button>
                  <button className="btn tiny" onClick={() => addLine("discount")}>
                    + Discount
                  </button>
                  <button className="btn tiny" onClick={() => addLine("note")}>
                    + Note
                  </button>
                  <button className="btn tiny" onClick={() => setPick("checklist")} title="The walk-around checklist, filled from the keyboard">
                    Checklist
                  </button>
                </div>
              )}
            </div>
          </div>
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
              <Field label="Written by">
                <select value={o.writerId || ""} onChange={(e) => update({ writerId: e.target.value || null })} disabled={locked}>
                  <option value="">—</option>
                  {techs.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Technician">
                <select value={o.techId || ""} onChange={(e) => update({ techId: e.target.value || null })} disabled={locked}>
                  <option value="">—</option>
                  {techs.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
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

      {pick === "customer" && <CustomerPicker shop={shop} onPick={pickCustomer} onClose={() => setPick(null)} />}
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
      {pick === "oil" && (
        <OilChangePicker
          cfg={cfg}
          shop={shop}
          spec={vehicle ? (findSpec(shop.specs, vehicle) || {}).spec : null}
          onClose={() => setPick(null)}
          onAdd={(lines, pkg) => {
            addLines(lines.map((l) => (l.kind === "labor" ? { ...l, techId: o.techId || null } : l)));
            setPick(!o.checklist && cfg.checklistOnOil !== false ? "checklist" : null);
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
            let lines = jobLines(j, cfg, shop.parts, uid, count).map((l) => (l.kind === "labor" ? { ...l, techId: o.techId || null } : l));
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
          prior={priorChecklist(shop.orders, o.vehicleId, o.id)}
          onCancel={() => setPick(null)}
          onSave={(items) => {
            const at = Date.now();
            update((d) => ({
              ...d,
              checklist: { at, byId: d.techId || null, items },
              history: d.checklist ? d.history : [...(d.history || []), { at, what: "service checklist filled" }],
            }));
            setPick(null);
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
    </>
  );
}

function LineRow({ l, prev, rules, techs, locked, set, remove }) {
  const showJob = l.job && (!prev || prev.job !== l.job);
  const tag = { part: "Part", labor: "Labor", sublet: "Sublet", fee: "Fee", discount: "Discount", note: "Note" }[l.kind];
  const taxable = lineTaxable(l, rules);
  return (
    <>
      {showJob && (
        <tr className="jobHead">
          <td colSpan={8}>{l.job}</td>
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
                <input className="r" inputMode="decimal" value={l.price} onChange={(e) => set({ price: e.target.value })} onBlur={(e) => set({ price: toNum(e.target.value) })} readOnly={locked} />
              )}
            </td>
            <td className="chk">
              <input type="checkbox" checked={taxable} onChange={(e) => set({ taxable: e.target.checked })} disabled={locked} title={l.kind === "discount" ? "Checked: this discount lowers the taxable amount" : "Taxable"} />
            </td>
            <td className="r lineAmt">{l.kind === "discount" ? "-" : ""}<Money v={lineAmount(l)} /></td>
          </>
        )}
        <td>
          {!locked && (
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
function SpecsCard({ vehicle, shop, cfg, locked, onEdit, onAdd }) {
  const found = findSpec(shop.specs, vehicle);
  const sp = found && found.spec;
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
