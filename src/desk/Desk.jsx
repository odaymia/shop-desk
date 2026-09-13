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
import { SignatureStation } from "./Signing.jsx";
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
  ["signpad", "Signature pad"],
  ["settings", "Settings"],
];

const lsGet = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};
const lsDel = (k) => {
  try {
    localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
};

export function Desk({ cfg, saveCfg, roster, saveRoster, flash }) {
  const shop = useShop(cfg);
  const [page, setPage] = useState("orders");
  const [orderId, setOrderId] = useState(null);
  const [customerId, setCustomerId] = useState(null);
  const [printId, setPrintId] = useState(null);
  const [starting, setStarting] = useState(false);
  /* Kiosk lock: on the signature tablet, hide the whole desk behind the
     signature pad so customers and unauthorized staff can't wander into the
     program. Per-device (localStorage) with a code to get back out. */
  const [locked, setLocked] = useState(() => lsGet("sd:kioskLock") === "1");
  const [unlocking, setUnlocking] = useState(false);
  const employees = roster.filter((e) => e.active !== false);

  const lockKiosk = () => {
    let code = lsGet("sd:kioskCode") || "";
    if (!code) {
      const set = window.prompt("Set a code to unlock the signature pad later (4–8 digits):");
      if (set == null) return;
      if (!/^\d{4,8}$/.test(set.trim())) return flash("Enter 4 to 8 digits.", "out");
      code = set.trim();
      lsSet("sd:kioskCode", code);
    }
    lsSet("sd:kioskLock", "1");
    setPage("signpad");
    setLocked(true);
  };
  const tryUnlock = (entered) => {
    if (String(entered).trim() === (lsGet("sd:kioskCode") || "")) {
      lsDel("sd:kioskLock");
      setLocked(false);
      setUnlocking(false);
      return true;
    }
    return false;
  };

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

  if (locked) {
    return (
      <div className="kiosk">
        <SignatureStation shop={shop} cfg={cfg} flash={flash} />
        <button className="kioskExit" onClick={() => setUnlocking(true)} title="Staff: unlock">
          🔒
        </button>
        {unlocking && <KioskUnlock onClose={() => setUnlocking(false)} onTry={tryUnlock} />}
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
          {page === "tires" && <Tires shop={shop} cfg={cfg} flash={flash} />}
          {page === "jobs" && <Jobs shop={shop} cfg={cfg} flash={flash} />}
          {page === "vendors" && <Vendors shop={shop} flash={flash} />}
          {page === "staff" && <Staff roster={roster} saveRoster={saveRoster} flash={flash} />}
          {page === "reports" && <Reports shop={shop} cfg={cfg} employees={roster} nav={nav} />}
          {page === "signpad" && <SignatureStation shop={shop} cfg={cfg} flash={flash} onLock={lockKiosk} />}
          {page === "settings" && (
            <DeskSettings
              cfg={cfg}
              saveCfg={async (next) => {
                await saveCfg(next);
                if (next.portalEnabled) setTimeout(() => shop.publishShop(), 0);
              }}
              flash={flash}
              roster={roster}
              saveRoster={saveRoster}
              shop={shop}
            />
          )}
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

/* The code prompt to leave kiosk mode. */
function KioskUnlock({ onClose, onTry }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState(false);
  const submit = () => {
    if (!onTry(code)) {
      setErr(true);
      setCode("");
    }
  };
  return (
    <div className="kioskGate" onClick={onClose}>
      <div className="kioskGateCard" onClick={(e) => e.stopPropagation()}>
        <h3>Staff code</h3>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, "").slice(0, 8));
            setErr(false);
          }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Enter code"
        />
        {err && <p className="fldErr" style={{ margin: "6px 0 0" }}>Wrong code.</p>}
        <div className="rowBtns" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={submit} disabled={!code}>
            Unlock
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
