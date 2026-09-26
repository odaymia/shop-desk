import { useState, useEffect, useRef } from "react";
import "./desk.css";
import { useShop } from "./useShop.js";
import { Orders } from "./Orders.jsx";
import { OrderEditor } from "./OrderEditor.jsx";
import { Customers } from "./Customers.jsx";
import { Inventory } from "./Inventory.jsx";
import { Tires } from "./Tires.jsx";
import { Vendors } from "./Vendors.jsx";
import { Jobs } from "./Jobs.jsx";
import { Coupons } from "./Coupons.jsx";
import { Staff } from "./Staff.jsx";
import { Reports } from "./Reports.jsx";
import { DeskSettings } from "./DeskSettings.jsx";
import { EmailCenter } from "./EmailCenter.jsx";
import { dailyEmailTick, drainTick, postcardsWaiting } from "./emailRunner.js";
import { PrintTicket } from "./PrintTicket.jsx";
import { StartTicket } from "./StartTicket.jsx";
import { SignatureStation } from "./Signing.jsx";
import { BayDisplay } from "./BayDisplay.jsx";
import { Fleet } from "./Fleet.jsx";
import { DEMO } from "../lib/demo.js";
import defaultLogo from "../assets/genie-logo.png";

/* The front desk: tickets, customers, parts, reports. */

const PAGES = [
  ["orders", "Tickets"],
  ["customers", "Customers"],
  ["fleet", "Fleet"],
  ["inventory", "Inventory"],
  ["tires", "Tires"],
  ["jobs", "Canned jobs"],
  ["coupons", "Coupons"],
  ["email", "Marketing"],
  ["vendors", "Vendors"],
  ["staff", "Staff"],
  ["reports", "Reports"],
  ["signpad", "Signature pad"],
  ["baydisplay", "Bay display"],
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

  /* automatic emails: check once a day who's due, and every 15 minutes nudge
     the sender to send what's waiting (see emailRunner.js) */
  const shopRef = useRef(shop);
  shopRef.current = shop;
  useEffect(() => {
    if (!shop.loaded) return;
    const tick = () => {
      dailyEmailTick(shopRef.current, cfg).catch((e) => console.error("email automations", e));
      if (cfg.email && cfg.email.enabled !== false && cfg.email.fromEmail) drainTick();
    };
    const first = setTimeout(tick, 20000);
    const every = setInterval(tick, 15 * 60000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [shop.loaded, cfg]);

  const [page, setPage] = useState("orders");

  /* weekly postcard reminder: a banner and a count on Marketing while a
     batch is waiting; "Later" hides it until tomorrow */
  const [cardsDue, setCardsDue] = useState(0);
  const [cardsHidden, setCardsHidden] = useState(() => {
    try {
      return localStorage.getItem("bb:postcardNudgeHidden") === new Date().toISOString().slice(0, 10);
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (!shop.loaded || page === "email") return;
    let live = true;
    const check = () =>
      postcardsWaiting(shopRef.current, cfg)
        .then((r) => live && setCardsDue(r ? r.count : 0))
        .catch(() => {});
    const first = setTimeout(check, 8000);
    const every = setInterval(check, 6 * 3600000);
    return () => {
      live = false;
      clearTimeout(first);
      clearInterval(every);
    };
  }, [shop.loaded, cfg, page]);
  const reviewCards = () => {
    try {
      localStorage.setItem("bb:emailTab", JSON.stringify("postcards"));
    } catch {
      /* private window */
    }
    setCardsDue(0);
    nav.go("email");
  };
  const laterCards = () => {
    try {
      localStorage.setItem("bb:postcardNudgeHidden", new Date().toISOString().slice(0, 10));
    } catch {
      /* private window */
    }
    setCardsHidden(true);
  };
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
            {DEMO && <span className="brandDemoNote">Your shop's logo &amp; name go here — set them in Settings</span>}
          </div>
          {PAGES.map(([k, label]) => (
            <button key={k} className={`deskNavBtn ${page === k ? "on" : ""}`} onClick={() => nav.go(k)}>
              {label}
              {k === "email" && cardsDue > 0 && (
                <span title={`${cardsDue} postcards ready to mail`} style={{ marginLeft: 8, background: "var(--amber, #d9a400)", color: "#15171b", borderRadius: 99, padding: "1px 8px", fontSize: 12, fontWeight: 700 }}>
                  {cardsDue}
                </span>
              )}
            </button>
          ))}
          <div className="deskNavFoot">
            <button className="btn primary" onClick={() => newTicket()}>
              New ticket
            </button>
          </div>
        </nav>
        <div className="deskMain">
          {cardsDue > 0 && !cardsHidden && page !== "email" && (
            <div role="status" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "12px 16px 0", padding: "10px 14px", borderRadius: 10, background: "rgba(217,164,0,.14)", border: "1px solid rgba(217,164,0,.45)" }}>
              <span>
                📬 <b>{cardsDue} oil change postcard{cardsDue === 1 ? "" : "s"}</b> ready to mail this week.
              </span>
              <span style={{ flex: 1 }} />
              <button className="btn primary" onClick={reviewCards}>
                Review and mail
              </button>
              <button className="btn" onClick={laterCards}>
                Later
              </button>
            </div>
          )}
          {page === "orders" &&
            (orderId ? (
              <OrderEditor key={orderId} orderId={orderId} shop={shop} cfg={cfg} employees={employees} nav={nav} flash={flash} />
            ) : (
              <Orders shop={shop} cfg={cfg} nav={nav} onNew={newTicket} flash={flash} />
            ))}
          {page === "customers" && (
            <Customers shop={shop} cfg={cfg} nav={nav} flash={flash} customerId={customerId} onNew={newTicket} />
          )}
          {page === "fleet" && <Fleet shop={shop} cfg={cfg} nav={nav} flash={flash} onNew={newTicket} />}
          {page === "inventory" && <Inventory shop={shop} cfg={cfg} flash={flash} />}
          {page === "tires" && <Tires shop={shop} cfg={cfg} flash={flash} />}
          {page === "jobs" && <Jobs shop={shop} cfg={cfg} flash={flash} />}
          {page === "coupons" && <Coupons shop={shop} cfg={cfg} flash={flash} />}
          {page === "email" && <EmailCenter shop={shop} cfg={cfg} saveCfg={saveCfg} flash={flash} />}
          {page === "vendors" && <Vendors shop={shop} flash={flash} />}
          {page === "staff" && <Staff roster={roster} saveRoster={saveRoster} flash={flash} />}
          {page === "reports" && <Reports shop={shop} cfg={cfg} employees={roster} nav={nav} />}
          {page === "signpad" && <SignatureStation shop={shop} cfg={cfg} flash={flash} onLock={lockKiosk} />}
          {page === "baydisplay" && <BayDisplay shop={shop} cfg={cfg} />}
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
