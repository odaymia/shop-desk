import { useState } from "react";
import "./desk.css";
import { useShop } from "./useShop.js";
import { Orders } from "./Orders.jsx";
import { OrderEditor } from "./OrderEditor.jsx";
import { Customers } from "./Customers.jsx";
import { Inventory } from "./Inventory.jsx";
import { Tires } from "./Tires.jsx";
import { Vendors } from "./Vendors.jsx";
import { Jobs } from "./Jobs.jsx";
import { Staff } from "./Staff.jsx";
import { Reports } from "./Reports.jsx";
import { DeskSettings } from "./DeskSettings.jsx";
import { PrintTicket } from "./PrintTicket.jsx";
import { StartTicket } from "./StartTicket.jsx";
import defaultLogo from "../assets/genie-logo.png";

/* The front desk: tickets, customers, parts, reports. */

const PAGES = [
  ["orders", "Tickets"],
  ["customers", "Customers"],
  ["inventory", "Inventory"],
  ["tires", "Tires"],
  ["jobs", "Canned jobs"],
  ["vendors", "Vendors"],
  ["staff", "Staff"],
  ["reports", "Reports"],
  ["settings", "Settings"],
];

export function Desk({ cfg, saveCfg, roster, saveRoster, flash }) {
  const shop = useShop(cfg);
  const [page, setPage] = useState("orders");
  const [orderId, setOrderId] = useState(null);
  const [customerId, setCustomerId] = useState(null);
  const [printId, setPrintId] = useState(null);
  const [starting, setStarting] = useState(false);
  const employees = roster.filter((e) => e.active !== false);

  const nav = {
    page,
    go(p) {
      setPage(p);
      setOrderId(null);
      setCustomerId(null);
    },
    openOrder(id) {
      setPage("orders");
      setOrderId(id);
    },
    openCustomer(id) {
      setPage("customers");
      setCustomerId(id);
    },
    print: (id) => setPrintId(id),
  };

  /* from a customer or vehicle page the car is known; from anywhere else
     the ticket starts with the plate */
  const newTicket = async (opts) => {
    if (!opts || (!opts.customerId && !opts.vehicleId && !opts.walkIn)) {
      setStarting(true);
      return;
    }
    setStarting(false);
    const o = await shop.createOrder({ customerId: opts.customerId || null, vehicleId: opts.vehicleId || null });
    nav.openOrder(o.id);
  };

  if (!shop.loaded) {
    return (
      <div className="bootWrap">
        <div className="bootPulse" />
        <p className="bootTxt">Opening the front desk…</p>
      </div>
    );
  }

  const printOrder = printId ? shop.orders[printId] : null;

  return (
    <>
      <div className="desk">
        <nav className="deskNav">
          <div className="deskBrand">
            <img className="brandLogo" src={cfg.logo || defaultLogo} alt="" />
            <strong>{cfg.shopName}</strong>
            <span>Front desk</span>
          </div>
          {PAGES.map(([k, label]) => (
            <button key={k} className={`deskNavBtn ${page === k ? "on" : ""}`} onClick={() => nav.go(k)}>
              {label}
            </button>
          ))}
          <div className="deskNavFoot">
            <button className="btn primary" onClick={() => newTicket()}>
              New ticket
            </button>
          </div>
        </nav>
        <div className="deskMain">
          {page === "orders" &&
            (orderId ? (
              <OrderEditor key={orderId} orderId={orderId} shop={shop} cfg={cfg} employees={employees} nav={nav} flash={flash} />
            ) : (
              <Orders shop={shop} cfg={cfg} nav={nav} onNew={newTicket} flash={flash} />
            ))}
          {page === "customers" && (
            <Customers shop={shop} cfg={cfg} nav={nav} flash={flash} customerId={customerId} onNew={newTicket} />
          )}
          {page === "inventory" && <Inventory shop={shop} flash={flash} />}
          {page === "tires" && <Tires shop={shop} flash={flash} />}
          {page === "jobs" && <Jobs shop={shop} cfg={cfg} flash={flash} />}
          {page === "vendors" && <Vendors shop={shop} flash={flash} />}
          {page === "staff" && <Staff roster={roster} saveRoster={saveRoster} flash={flash} />}
          {page === "reports" && <Reports shop={shop} cfg={cfg} employees={roster} nav={nav} />}
          {page === "settings" && <DeskSettings cfg={cfg} saveCfg={saveCfg} flash={flash} roster={roster} saveRoster={saveRoster} shop={shop} />}
        </div>
      </div>
      {starting && (
        <StartTicket
          shop={shop}
          cfg={cfg}
          onClose={() => setStarting(false)}
          onStart={(opts) => newTicket({ ...opts, walkIn: !opts.customerId && !opts.vehicleId })}
        />
      )}
      {printOrder && <PrintTicket order={printOrder} shop={shop} cfg={cfg} employees={roster} onClose={() => setPrintId(null)} />}
    </>
  );
}
