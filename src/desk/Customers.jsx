import { useState, useMemo, useEffect } from "react";
import { cloud } from "../storage/index.js";
import { Money, fmtDate, fmtPhone } from "./ui.jsx";
import { CustomerForm, VehicleForm } from "./forms.jsx";
import { customerName, vehicleName, vehiclesOf, ordersOf, searchText } from "./useShop.js";
import { orderTotals, orderTitle, statusLabel } from "../lib/invoice.js";

export function Customers({ shop, cfg, nav, flash, customerId, onNew }) {
  const [q, setQ] = useState("");
  const [requests, setRequests] = useState([]);
  const loadRequests = () => cloud.listPortalRequests().then(setRequests).catch(() => setRequests([]));
  useEffect(() => {
    loadRequests();
  }, []);
  const [editing, setEditing] = useState(null); // customer draft
  const [showInactive, setShowInactive] = useState(false);

  /* Aggregate each customer's cars and invoiced history in ONE pass over
     vehicles and orders (indexed by owner), instead of scanning every
     order for every customer — that was O(customers x orders) and made
     this page crawl once a full history was imported. Recomputed only
     when the underlying records change, not on every keystroke. */
  const base = useMemo(() => {
    const vehsBy = {};
    for (const v of Object.values(shop.vehicles)) (vehsBy[v.customerId] = vehsBy[v.customerId] || []).push(v);
    const invBy = {};
    for (const o of Object.values(shop.orders)) {
      if (o.status !== "invoiced") continue;
      (invBy[o.customerId] = invBy[o.customerId] || []).push(o);
    }
    return Object.values(shop.customers).map((c) => {
      const vehs = vehsBy[c.id] || [];
      const orders = invBy[c.id] || [];
      let lifetime = 0;
      let last = null;
      for (const o of orders) {
        lifetime += orderTotals(o, cfg, c).total;
        if ((o.invoicedAt || 0) > (last || 0)) last = o.invoicedAt || null;
      }
      const hay = [c.first, c.last, c.company, c.phone, c.phone2, c.email, ...vehs.map((v) => `${vehicleName(v)} ${v.plate || ""}`)].join(" ");
      return { c, vehs, lifetime, last, visits: orders.length, hay };
    });
  }, [shop.customers, shop.vehicles, shop.orders, cfg]);

  const LIMIT = 400; // render a page at a time; search narrows the rest
  const matched = useMemo(
    () =>
      base
        .filter((r) => (showInactive || r.c.active !== false) && searchText(q, r.hay))
        .sort((a, b) => customerName(a.c).localeCompare(customerName(b.c))),
    [base, q, showInactive]
  );
  const rows = matched.slice(0, LIMIT);

  if (customerId && shop.customers[customerId])
    return <CustomerDetail shop={shop} cfg={cfg} nav={nav} flash={flash} customer={shop.customers[customerId]} onNew={onNew} />;

  return (
    <>
      <header className="deskHead">
        <h1>Customers</h1>
        <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone, plate, or vehicle" />
        <label className="fld inline" style={{ margin: 0 }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          <span className="muted">Show inactive</span>
        </label>
        <div className="grow" />
        <button className="btn primary" onClick={() => setEditing({})}>
          New customer
        </button>
      </header>
      <div className="deskBody">
        {requests.length > 0 && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="cardHead">
              <h3>From the customer portal</h3>
            </div>
            <ul className="fillList">
              {requests.map((r) => {
                const c = shop.customers[r.customer_id];
                const v = shop.vehicles[r.vehicle_id];
                const done = async (detach) => {
                  if (detach && v) await shop.saveVehicle({ ...v, customerId: null, active: r.kind === "sold" ? false : v.active });
                  await cloud.handlePortalRequest(r.id);
                  if (c) await shop.saveCustomer(c); // republish their portal record
                  flash(detach ? "Car removed from the customer" : "Request dismissed");
                  loadRequests();
                };
                return (
                  <li key={r.id} style={{ alignItems: "center" }}>
                    <div>
                      <strong>{customerName(c)}</strong> ({r.email}) says {r.kind === "sold" ? "they sold" : "they never owned"}{" "}
                      <strong>{vehicleName(v)}</strong>
                      {v && v.plate ? ` · ${v.plate}` : ""}
                    </div>
                    <span className="rowActs">
                      <button className="btn tiny primary" onClick={() => done(true)}>
                        {r.kind === "sold" ? "Mark sold, remove" : "Remove from them"}
                      </button>
                      <button className="btn tiny" onClick={() => done(false)}>
                        Keep as is
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <div className="tableCard scroll">
          <table className="dk">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Phone</th>
                <th>Vehicles</th>
                <th className="r">Visits</th>
                <th>Last visit</th>
                <th className="r">Lifetime</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="emptyNote">
                    {q ? "No one matches." : "No customers yet. Add one, or start a ticket and add them there."}
                  </td>
                </tr>
              )}
              {rows.map(({ c, vehs, lifetime, last, visits }) => (
                <tr key={c.id} className={`row ${c.active === false ? "off" : ""}`} onClick={() => nav.openCustomer(c.id)}>
                  <td>
                    <strong>{customerName(c)}</strong>
                    {c.company && c.first ? <span className="sub">{c.company}</span> : null}
                  </td>
                  <td className="num">{fmtPhone(c.phone)}</td>
                  <td className="muted">{vehs.map(vehicleName).join(", ") || "—"}</td>
                  <td className="r num">{visits}</td>
                  <td className="muted">{fmtDate(last)}</td>
                  <td className="r num">
                    <Money v={lifetime} />
                  </td>
                </tr>
              ))}
              {matched.length > LIMIT && (
                <tr>
                  <td colSpan={6} className="emptyNote">
                    Showing the first {LIMIT.toLocaleString()} of {matched.length.toLocaleString()}. Type a name, phone, or plate to find the rest.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {editing && (
        <CustomerForm
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={async (c) => {
            const saved = await shop.saveCustomer(c);
            setEditing(null);
            flash("Customer saved");
            nav.openCustomer(saved.id);
          }}
        />
      )}
    </>
  );
}

function CustomerDetail({ shop, cfg, nav, flash, customer: c, onNew }) {
  const [editing, setEditing] = useState(false);
  const [vehEdit, setVehEdit] = useState(null); // vehicle draft or {} for new
  const vehs = vehiclesOf(shop.vehicles, c.id);
  const history = ordersOf(shop.orders, { customerId: c.id });
  const address = [c.street, [c.city, c.state].filter(Boolean).join(", "), c.zip].filter(Boolean).join(" ");

  return (
    <>
      <header className="deskHead">
        <button className="btn ghost" onClick={() => nav.go("customers")}>
          ← Customers
        </button>
        <h1>{customerName(c)}</h1>
        {c.active === false && <span className="st void">Inactive</span>}
        {c.taxExempt && <span className="st">Tax exempt</span>}
        <div className="grow" />
        <button className="btn" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button className="btn primary" onClick={() => onNew({ customerId: c.id, vehicleId: vehs[0] ? vehs[0].id : null })}>
          New ticket
        </button>
      </header>
      <div className="deskBody deskSplit">
        <div className="stack">
          <div className="card">
            <div className="cardHead">
              <h3>Vehicles</h3>
              <button className="btn tiny" onClick={() => setVehEdit({})}>
                Add vehicle
              </button>
            </div>
            {vehs.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No vehicles on file yet.
              </p>
            ) : (
              <table className="dk">
                <thead>
                  <tr>
                    <th>Vehicle</th>
                    <th>Plate</th>
                    <th>VIN</th>
                    <th className="r">Mileage</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {vehs.map((v) => (
                    <tr key={v.id}>
                      <td>
                        <strong>{vehicleName(v)}</strong>
                        {v.engine || v.color ? <span className="sub">{[v.engine, v.color].filter(Boolean).join(" · ")}</span> : null}
                      </td>
                      <td className="num">{v.plate || "—"}</td>
                      <td className="num muted">{v.vin || "—"}</td>
                      <td className="r num">{v.mileage ? Number(v.mileage).toLocaleString() : "—"}</td>
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
              <h3>History</h3>
            </div>
            {history.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No tickets yet.
              </p>
            ) : (
              <table className="dk">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Date</th>
                    <th>Vehicle</th>
                    <th>Work</th>
                    <th className="r">Total</th>
                    <th className="r">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((o) => {
                    const t = orderTotals(o, cfg, c);
                    return (
                      <tr key={o.id} className="row" onClick={() => nav.openOrder(o.id)}>
                        <td>
                          <strong>#{o.number}</strong> <span className={`st ${o.status}`}>{statusLabel(o.status)}</span>
                        </td>
                        <td className="muted">{fmtDate(o.invoicedAt || o.createdAt)}</td>
                        <td className="muted">{vehicleName(shop.vehicles[o.vehicleId])}</td>
                        <td className="muted">{workSummary(o)}</td>
                        <td className="r num">
                          <Money v={t.total} />
                        </td>
                        <td className="r num">{o.status === "invoiced" && t.balance > 0.001 ? <Money v={t.balance} className="hot" /> : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="cardHead">
              <h3>Contact</h3>
            </div>
            <dl className="kv">
              <dt>Phone</dt>
              <dd className="num">{fmtPhone(c.phone) || "—"}</dd>
              {c.phone2 && (
                <>
                  <dt>Phone 2</dt>
                  <dd className="num">{fmtPhone(c.phone2)}</dd>
                </>
              )}
              <dt>Email</dt>
              <dd>{c.email || "—"}</dd>
              <dt>Address</dt>
              <dd>{address || "—"}</dd>
              {c.company && (
                <>
                  <dt>Company</dt>
                  <dd>{c.company}</dd>
                </>
              )}
              <dt>Since</dt>
              <dd>{fmtDate(c.createdAt)}</dd>
            </dl>
            {c.notes && <p className="noteBox" style={{ marginTop: 12 }}>{c.notes}</p>}
          </div>
          <div className="card">
            <button
              className="btn tiny"
              onClick={async () => {
                await shop.saveCustomer({ ...c, active: c.active === false });
                flash(c.active === false ? "Customer is active again" : "Customer set inactive");
              }}
            >
              {c.active === false ? "Make active" : "Set inactive"}
            </button>
          </div>
        </div>
      </div>

      {editing && (
        <CustomerForm
          initial={c}
          onClose={() => setEditing(false)}
          onSave={async (next) => {
            await shop.saveCustomer(next);
            setEditing(false);
            flash("Customer saved");
          }}
        />
      )}
      {vehEdit && (
        <VehicleForm
          cfg={cfg}
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

/* "Oil change, Brake pads" — the first few labor or job names on a ticket. */
export function workSummary(o) {
  const names = [];
  for (const l of o.lines || []) {
    const n = l.job || (l.kind === "labor" ? l.description : "");
    if (n && !names.includes(n)) names.push(n);
    if (names.length >= 3) break;
  }
  if (!names.length && o.lines && o.lines.length) return `${o.lines.length} line${o.lines.length === 1 ? "" : "s"}`;
  return names.join(", ") || (o.concern ? o.concern.slice(0, 40) : "—");
}

export { orderTitle };
