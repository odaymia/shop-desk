import { useState, useMemo } from "react";
import { Modal, Money, fmtDate } from "./ui.jsx";
import { customerName, vehicleName, searchText, isLive } from "./useShop.js";
import { orderTotals, statusLabel, owesBalance } from "../lib/invoice.js";
import { workSummary } from "./Customers.jsx";

const FILTERS = [
  ["estimate", "Estimates"],
  ["open", "Repair orders"],
  ["invoiced", "Invoices"],
  ["due", "Balance due"],
  ["all", "All"],
];

export function Orders({ shop, cfg, nav, onNew, flash }) {
  const [filter, setFilter] = useState("open");
  const [q, setQ] = useState("");
  const [toDelete, setToDelete] = useState(null);

  const LIMIT = 400; // render a page at a time; the search box reaches the rest
  const matched = useMemo(() => {
    const all = Object.values(shop.orders).filter(isLive).map((o) => {
      const c = shop.customers[o.customerId];
      const v = shop.vehicles[o.vehicleId];
      return { o, c, v, t: orderTotals(o, cfg, c) };
    });
    /* A real duplicate number means two devices, offline, both grabbed the
       same next number for a NEW ticket. Imported history doesn't count:
       LubeSoft and Mitchell reused invoice numbers across numbering runs,
       so an old visit and a recent one legitimately share a number. Only
       flag collisions among tickets created on the desk. */
    const numbers = {};
    for (const r of all) if (!r.o.imported) numbers[r.o.number] = (numbers[r.o.number] || 0) + 1;
    return all
      .filter(({ o, t }) => {
        if (filter === "all") return true;
        if (filter === "due") return owesBalance(o, t);
        return o.status === filter;
      })
      .filter(({ o, c, v }) =>
        searchText(q, `#${o.number}`, String(o.number), customerName(c), c && c.phone, vehicleName(v), v && v.plate, o.concern)
      )
      .map((r) => ({ ...r, dup: !r.o.imported && numbers[r.o.number] > 1 }))
      .sort((a, b) => (b.o.invoicedAt || b.o.createdAt) - (a.o.invoicedAt || a.o.createdAt));
  }, [shop.orders, shop.customers, shop.vehicles, cfg, filter, q]);
  const rows = matched.slice(0, LIMIT);

  const counts = useMemo(() => {
    const n = { estimate: 0, open: 0, invoiced: 0, due: 0 };
    for (const o of Object.values(shop.orders)) {
      if (!isLive(o)) continue;
      if (n[o.status] != null) n[o.status]++;
      if (owesBalance(o, orderTotals(o, cfg, shop.customers[o.customerId]))) n.due++;
    }
    return n;
  }, [shop.orders, shop.customers, cfg]);

  return (
    <>
      <header className="deskHead">
        <h1>Tickets</h1>
        <div className="seg">
          {FILTERS.map(([k, label]) => (
            <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>
              {label}
              {counts[k] ? ` (${counts[k]})` : ""}
            </button>
          ))}
        </div>
        <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticket #, name, plate, vehicle" />
        <div className="grow" />
        <button className="btn primary" onClick={() => onNew()}>
          New ticket
        </button>
      </header>
      <div className="deskBody">
        <div className="tableCard scroll">
          <table className="dk">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Vehicle</th>
                <th>Work</th>
                <th className="r">Total</th>
                <th className="r">Balance</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="emptyNote">
                    {q ? "Nothing matches." : filter === "open" ? "No open repair orders. Start a new ticket, or check Estimates." : "Nothing here yet."}
                  </td>
                </tr>
              )}
              {rows.map(({ o, c, v, t, dup }) => (
                <tr key={o.id} className="row" onClick={() => nav.openOrder(o.id)}>
                  <td>
                    <strong>#{o.number}</strong> <span className={`st ${o.status}`}>{statusLabel(o.status)}</span>
                    {dup && <span className="sub" style={{ color: "var(--warn)" }}>Duplicate number — two devices made tickets offline</span>}
                  </td>
                  <td className="muted">{fmtDate(o.invoicedAt || o.createdAt)}</td>
                  <td>{customerName(c)}</td>
                  <td className="muted">
                    {vehicleName(v)}
                    {v && v.plate ? <span className="sub">{v.plate}</span> : null}
                  </td>
                  <td className="muted">{workSummary(o)}</td>
                  <td className="r num">
                    <Money v={t.total} />
                  </td>
                  <td className="r num">
                    {o.status === "void" ? (
                      "—"
                    ) : owesBalance(o, t) ? (
                      <span className="st due">
                        <Money v={t.balance} />
                      </span>
                    ) : o.status === "invoiced" ? (
                      <span className="st paid">Paid</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="r">
                    {(o.status === "estimate" || o.status === "open") && (
                      <button
                        className="btn tiny danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          setToDelete(o);
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {matched.length > LIMIT && (
                <tr>
                  <td colSpan={8} className="emptyNote">
                    Showing the most recent {LIMIT.toLocaleString()} of {matched.length.toLocaleString()}. Search by ticket number, name, or plate to find older ones.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {toDelete && (
        <ConfirmDelete
          order={toDelete}
          onClose={() => setToDelete(null)}
          onConfirm={async () => {
            await shop.setStatus(toDelete, "deleted", shop.customers[toDelete.customerId]);
            setToDelete(null);
            if (flash) flash(`Ticket #${toDelete.number} deleted`, "out");
          }}
        />
      )}
    </>
  );
}

export function ConfirmDelete({ order, onClose, onConfirm }) {
  return (
    <Modal title={`Delete ${statusLabel(order.status).toLowerCase()} #${order.number}?`} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0, lineHeight: 1.5 }}>
        Are you sure you want to delete this? This cannot be reversed.
      </p>
      <div className="rowBtns" style={{ marginTop: 10 }}>
        <button className="btn danger lg" onClick={onConfirm}>
          Yes, delete it
        </button>
        <button className="btn lg" onClick={onClose}>
          Keep it
        </button>
      </div>
    </Modal>
  );
}
