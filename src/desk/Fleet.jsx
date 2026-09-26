import { useMemo, useState } from "react";
import { Money, Modal, fmtDate } from "./ui.jsx";
import { CustomerForm, VehicleForm } from "./forms.jsx";
import { vehicleName, vehiclesOf, ordersOf, searchText, customerName, activeList } from "./useShop.js";
import { workSummary } from "./Customers.jsx";
import { isFleet, fleetName, fleetStats, DEFAULT_FLEET, moveVehicleToFleet } from "../lib/fleet.js";
import { orderTotals, statusLabel } from "../lib/invoice.js";

/* Fleet accounts: businesses with a house account, automatic per-category
   discounts, all their cars in one place, and a spend/owed report. */
export function Fleet({ shop, cfg, nav, flash, onNew }) {
  const [selId, setSelId] = useState(null);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(false); // true = new, "info" = edit contact
  const [vehEdit, setVehEdit] = useState(null);

  const accounts = useMemo(
    () => Object.values(shop.customers).filter(isFleet).sort((a, b) => fleetName(a).localeCompare(fleetName(b))),
    [shop.customers],
  );
  const shown = accounts.filter((c) => searchText(q, fleetName(c), c.phone, c.email));
  const cust = selId ? shop.customers[selId] : null;

  const saveNew = async (c) => {
    const saved = await shop.saveCustomer({ ...c, fleet: DEFAULT_FLEET });
    setEditing(false);
    setSelId(saved.id);
    flash("Fleet account added");
  };

  if (cust) {
    return (
      <FleetDetail
        shop={shop}
        cfg={cfg}
        nav={nav}
        flash={flash}
        onNew={onNew}
        cust={cust}
        onBack={() => setSelId(null)}
        editing={editing}
        setEditing={setEditing}
        vehEdit={vehEdit}
        setVehEdit={setVehEdit}
      />
    );
  }

  return (
    <>
      <header className="deskHead">
        <h1>Fleet accounts</h1>
        <div className="grow" />
        <button className="btn primary" onClick={() => setEditing(true)}>
          New fleet account
        </button>
      </header>
      <div className="deskBody">
        <div className="rowBtns" style={{ marginBottom: 12 }}>
          <input className="search" style={{ flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Fleet name, phone, or email" />
        </div>
        {accounts.length === 0 ? (
          <p className="muted">No fleet accounts yet. Add one, or turn a company customer into a fleet account from their profile.</p>
        ) : (
          <table className="dk">
            <thead>
              <tr>
                <th>Account</th>
                <th className="r">Cars</th>
                <th>Discounts</th>
                <th className="r">On account</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const cars = vehiclesOf(shop.vehicles, c.id).length;
                const d = (c.fleet && c.fleet.discounts) || {};
                const st = fleetStats(Object.values(shop.orders), c, cfg, shop.parts);
                return (
                  <tr key={c.id} className="row" onClick={() => setSelId(c.id)}>
                    <td>
                      <strong>{fleetName(c)}</strong>
                      <span className="sub">{[c.phone, c.email].filter(Boolean).join(" · ")}</span>
                    </td>
                    <td className="r num">{cars}</td>
                    <td className="muted">{`Oil ${d.oil || 0}% · Tires ${d.tires || 0}% · Mech ${d.mechanical || 0}%`}</td>
                    <td className="r num">{st.onAccount > 0 ? <Money v={st.onAccount} className="hot" /> : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {editing && <CustomerForm cfg={cfg} onClose={() => setEditing(false)} onSave={saveNew} />}
    </>
  );
}

function FleetDetail({ shop, cfg, nav, flash, onNew, cust: c, onBack, editing, setEditing, vehEdit, setVehEdit }) {
  const vehs = vehiclesOf(shop.vehicles, c.id);
  const history = ordersOf(shop.orders, { customerId: c.id });
  const stats = useMemo(() => fleetStats(Object.values(shop.orders), c, cfg, shop.parts), [shop.orders, c, cfg, shop.parts]);
  const d = (c.fleet && c.fleet.discounts) || {};
  const [oil, setOil] = useState(String(d.oil ?? 0));
  const [tires, setTires] = useState(String(d.tires ?? 0));
  const [mech, setMech] = useState(String(d.mechanical ?? 0));
  const [po, setPo] = useState(!!(c.fleet && c.fleet.poRequired));
  const [notes, setNotes] = useState((c.fleet && c.fleet.notes) || "");

  const [pickCar, setPickCar] = useState(false);
  const num = (v) => Math.max(0, Math.min(100, Number(v) || 0));
  const saveDiscounts = async () => {
    await shop.saveCustomer({ ...c, fleet: { ...(c.fleet || {}), discounts: { oil: num(oil), tires: num(tires), mechanical: num(mech) }, poRequired: po, notes: notes.trim() } });
    flash("Fleet discounts saved");
  };
  const removeFleet = async () => {
    if (!window.confirm(`Remove ${fleetName(c)} as a fleet account? Their cars and history stay; only the account discounts are removed.`)) return;
    const next = { ...c };
    delete next.fleet;
    await shop.saveCustomer(next);
    flash("Removed from fleet accounts");
    onBack();
  };

  return (
    <>
      <header className="deskHead">
        <button className="btn ghost" onClick={onBack}>
          ← Fleet
        </button>
        <h1>{fleetName(c)}</h1>
        <span className="st">Fleet account</span>
        <div className="grow" />
        <button className="btn" onClick={() => setEditing("info")}>
          Edit info
        </button>
        <button className="btn primary" onClick={() => onNew({ customerId: c.id, vehicleId: vehs[0] ? vehs[0].id : null })}>
          New ticket
        </button>
      </header>
      <div className="deskBody deskSplit">
        <div className="stack">
          <div className="card">
            <div className="cardHead">
              <h3>Automatic discounts</h3>
            </div>
            <p className="muted" style={{ marginTop: 0 }}>Applied to every ticket for this account, by category.</p>
            <div className="fleetDisc">
              <label className="fld">
                <span>Oil changes %</span>
                <input inputMode="decimal" value={oil} onChange={(e) => setOil(e.target.value.replace(/[^0-9.]/g, ""))} />
              </label>
              <label className="fld">
                <span>Tires %</span>
                <input inputMode="decimal" value={tires} onChange={(e) => setTires(e.target.value.replace(/[^0-9.]/g, ""))} />
              </label>
              <label className="fld">
                <span>Mechanical %</span>
                <input inputMode="decimal" value={mech} onChange={(e) => setMech(e.target.value.replace(/[^0-9.]/g, ""))} />
              </label>
            </div>
            <label className="fld inline" style={{ marginTop: 10 }}>
              <input type="checkbox" checked={po} onChange={(e) => setPo(e.target.checked)} />
              <span>Requires a PO number on tickets</span>
            </label>
            <label className="fld" style={{ marginTop: 10 }}>
              <span>Account notes (billing contact, terms)</span>
              <textarea className="ta" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <div className="rowBtns" style={{ marginTop: 12 }}>
              <button className="btn primary" onClick={saveDiscounts}>
                Save discounts
              </button>
              <button className="btn danger ghost" onClick={removeFleet}>
                Remove from fleet
              </button>
            </div>
          </div>

          <div className="card">
            <div className="cardHead">
              <h3>Account report</h3>
            </div>
            <div className="fleetStats">
              <div>
                <span>Cars</span>
                <b>{vehs.length}</b>
              </div>
              <div>
                <span>Visits</span>
                <b>{stats.visits}</b>
              </div>
              <div>
                <span>Lifetime</span>
                <b>
                  <Money v={stats.lifetime} />
                </b>
              </div>
              <div>
                <span>Saved by discounts</span>
                <b>
                  <Money v={stats.saved} />
                </b>
              </div>
              <div>
                <span>On account (owed)</span>
                <b className={stats.onAccount > 0 ? "hot" : ""}>
                  <Money v={stats.onAccount} />
                </b>
              </div>
              <div>
                <span>Last visit</span>
                <b>{stats.last ? fmtDate(stats.last) : "—"}</b>
              </div>
            </div>
            <div className="fleetCats">
              <span>By type — Oil <Money v={stats.byCat.oil} /> · Tires <Money v={stats.byCat.tires} /> · Mechanical <Money v={stats.byCat.mechanical} /></span>
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="cardHead">
              <h3>Vehicles</h3>
              <span className="rowActs">
                <button className="btn tiny primary" onClick={() => setPickCar(true)}>
                  Add a car we've seen
                </button>
                <button className="btn tiny" onClick={() => setVehEdit({})}>
                  New car
                </button>
              </span>
            </div>
            {vehs.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>No vehicles on file yet.</p>
            ) : (
              <table className="dk">
                <tbody>
                  {vehs.map((v) => (
                    <tr key={v.id}>
                      <td>
                        <strong>{vehicleName(v)}</strong>
                        {v.plate ? <span className="sub">{v.plate}</span> : null}
                      </td>
                      <td className="r">
                        <span className="rowActs">
                          <button className="btn tiny" onClick={() => setVehEdit(v)}>
                            Edit
                          </button>
                          <button className="btn tiny primary" onClick={() => onNew({ customerId: c.id, vehicleId: v.id })}>
                            Ticket
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <div className="cardHead">
              <h3>Recent tickets</h3>
            </div>
            {history.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>No tickets yet.</p>
            ) : (
              <table className="dk">
                <tbody>
                  {history.slice(0, 12).map((o) => {
                    const t = orderTotals(o, cfg, c);
                    return (
                      <tr key={o.id} className="row" onClick={() => nav.openOrder(o.id)}>
                        <td>
                          <strong>#{o.number}</strong> <span className={`st ${o.status}`}>{statusLabel(o.status)}</span>
                          <span className="sub">{vehicleName(shop.vehicles[o.vehicleId])}</span>
                        </td>
                        <td className="muted">{fmtDate(o.invoicedAt || o.createdAt)}</td>
                        <td className="muted">{workSummary(o)}</td>
                        <td className="r num">
                          <Money v={t.total} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {editing === "info" && (
        <CustomerForm
          cfg={cfg}
          initial={c}
          onClose={() => setEditing(false)}
          onSave={async (next) => {
            await shop.saveCustomer({ ...next, fleet: c.fleet });
            setEditing(false);
            flash("Saved");
          }}
        />
      )}
      {pickCar && <AddExistingCar shop={shop} cfg={cfg} fleet={c} flash={flash} onClose={() => setPickCar(false)} />}
      {vehEdit && (
        <VehicleForm
          cfg={cfg}
          shop={shop}
          initial={vehEdit.id ? vehEdit : null}
          customerId={c.id}
          onClose={() => setVehEdit(null)}
          onSave={async (v) => {
            await shop.saveVehicle(v);
            setVehEdit(null);
            flash("Vehicle saved");
          }}
        />
      )}
    </>
  );
}

/* Find cars already in the desk (by plate, VIN, car, or owner) and move
   them onto this fleet account, optionally with their past tickets. Picks
   stay ticked across searches, so a whole fleet goes on in one pass. */
function AddExistingCar({ shop, cfg, fleet, flash, onClose }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState({}); // vehicleId → move its past tickets too
  const [busy, setBusy] = useState(false);

  /* visits per car, counted once (the desk can hold tens of thousands of tickets) */
  const visits = useMemo(() => {
    const m = {};
    for (const o of Object.values(shop.orders || {})) if (o && o.vehicleId && o.status !== "deleted" && o.customerId !== fleet.id) m[o.vehicleId] = (m[o.vehicleId] || 0) + 1;
    return m;
  }, [shop.orders, fleet.id]);
  const isNameless = (o) => !o || (o.ls && o.ls.placeholder) || !(o.first || o.last || o.company || o.phone);
  const who = (o) => (!o ? "No owner" : isNameless(o) ? "Walk-in" : customerName(o));

  const matches = useMemo(() => {
    const needle = q.trim();
    if (needle.length < 2) return [];
    const out = [];
    for (const v of activeList(shop.vehicles)) {
      if (v.customerId === fleet.id) continue;
      const owner = shop.customers[v.customerId];
      if (searchText(needle, v.plate, v.vin, vehicleName(v), v.unit, owner && customerName(owner), owner && owner.company, owner && owner.phone)) out.push(v);
      if (out.length >= 60) break;
    }
    return out;
  }, [q, shop.vehicles, shop.customers, fleet.id]);

  /* past tickets come along by default only when the old owner was a walk-in */
  const toggle = (v) =>
    setSel((m) => {
      const next = { ...m };
      if (v.id in next) delete next[v.id];
      else next[v.id] = !!isNameless(shop.customers[v.customerId]);
      return next;
    });
  const allShown = matches.length > 0 && matches.every((v) => v.id in sel);
  const toggleAll = () =>
    setSel((m) => {
      const next = { ...m };
      for (const v of matches) {
        if (allShown) delete next[v.id];
        else if (!(v.id in next)) next[v.id] = !!isNameless(shop.customers[v.customerId]);
      }
      return next;
    });
  const picked = Object.keys(sel).map((id) => shop.vehicles[id]).filter(Boolean);

  const save = async () => {
    setBusy(true);
    try {
      const all = Object.values(shop.orders || {});
      const vehs = [];
      const orders = [];
      for (const v of picked) {
        const r = moveVehicleToFleet({ vehicle: v, orders: all, fleet, fromCustomer: shop.customers[v.customerId], cfg, moveHistory: sel[v.id] });
        vehs.push(r.vehicle);
        orders.push(...r.orders);
      }
      await shop.saveVehiclesBulk(vehs);
      if (orders.length) await shop.saveOrdersBulk(orders);
      flash(`${vehs.length} car${vehs.length === 1 ? "" : "s"} added to ${fleetName(fleet)}${orders.length ? ` with ${orders.length} past ticket${orders.length === 1 ? "" : "s"}` : ""}`);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Add cars to ${fleetName(fleet)}`} onClose={onClose} size="lg">
      <input className="search" autoFocus style={{ width: "100%" }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Plate, VIN, car, owner name, or phone" />
      {q.trim().length < 2 ? (
        <p className="muted">Type at least two letters or numbers. Tick as many cars as you like; your picks stay ticked when you search again.</p>
      ) : matches.length === 0 ? (
        <p className="muted">No car matches. Use New car to add one.</p>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "10px 0 4px" }}>
            <span className="muted">{matches.length >= 60 ? "First 60 matches. Type more to narrow it down." : `${matches.length} match${matches.length === 1 ? "" : "es"}`}</span>
            <button type="button" className="btn tiny" onClick={toggleAll}>
              {allShown ? "Untick these" : "Tick all shown"}
            </button>
          </div>
          <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
            <table className="dk">
              <tbody>
                {matches.map((v) => {
                  const n = visits[v.id] || 0;
                  return (
                    <tr key={v.id} className="row" onClick={() => toggle(v)}>
                      <td style={{ width: 28 }}>
                        <input type="checkbox" checked={v.id in sel} readOnly style={{ pointerEvents: "none" }} />
                      </td>
                      <td>
                        <strong>{vehicleName(v)}</strong>
                        <span className="sub">{[v.plate, v.vin].filter(Boolean).join(" · ")}</span>
                      </td>
                      <td className="muted">{who(shop.customers[v.customerId])}</td>
                      <td className="r num muted">{n ? `${n} visit${n === 1 ? "" : "s"}` : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {picked.length > 0 && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18, gap: 10 }}>
            <h3 className="subhead" style={{ margin: 0 }}>
              Adding {picked.length} car{picked.length === 1 ? "" : "s"}
            </h3>
            {picked.some((v) => visits[v.id]) && (
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={picked.filter((v) => visits[v.id]).every((v) => sel[v.id])}
                  onChange={(e) => setSel((m) => Object.fromEntries(Object.keys(m).map((id) => [id, e.target.checked])))}
                />
                Move all past tickets
              </label>
            )}
          </div>
          <p className="muted" style={{ margin: "0 0 6px" }}>
            Tick "past tickets" to move a car's earlier visits onto this account's history and report. Their totals don't change. Leave it off when the car belonged to someone else before.
          </p>
          <div style={{ maxHeight: 240, overflowY: "auto" }}>
            <table className="dk">
              <tbody>
                {picked.map((v) => {
                  const n = visits[v.id] || 0;
                  return (
                    <tr key={v.id}>
                      <td>
                        <strong>{vehicleName(v)}</strong>
                        <span className="sub">
                          {[v.plate, `from ${who(shop.customers[v.customerId])}`].filter(Boolean).join(" · ")}
                        </span>
                      </td>
                      <td>
                        {n > 0 ? (
                          <label style={{ display: "flex", gap: 6, alignItems: "center", whiteSpace: "nowrap" }}>
                            <input type="checkbox" checked={!!sel[v.id]} onChange={(e) => setSel((m) => ({ ...m, [v.id]: e.target.checked }))} />
                            {n} past ticket{n === 1 ? "" : "s"}
                          </label>
                        ) : (
                          <span className="muted">No past tickets</span>
                        )}
                      </td>
                      <td className="r">
                        <button type="button" className="btn tiny ghost" onClick={() => toggle(v)} aria-label="Remove">
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="rowBtns" style={{ marginTop: 14 }}>
        <button className="btn primary" disabled={busy || picked.length === 0} onClick={save}>
          {busy ? "Adding…" : picked.length ? `Add ${picked.length} car${picked.length === 1 ? "" : "s"} to fleet` : "Add to fleet"}
        </button>
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
