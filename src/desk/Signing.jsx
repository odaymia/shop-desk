import { useRef, useEffect, useState, Fragment } from "react";
import { fmtDate } from "./ui.jsx";
import { fmtMoney, orderTotals, lineAmount, laborQtyText, conditionLabel, statusLabel, owesBalance } from "../lib/invoice.js";
import { customerName, vehicleName } from "./useShop.js";
import { parseAuthText } from "../lib/authForm.js";
import { cloud, sGet, sDel } from "../storage/index.js";
import { SIGNREQ_KEY, INFOREQ_KEY, INTAKEREQ_KEY } from "../lib/keys.js";
import { QR, portalUrl } from "./QR.jsx";
import { matchExistingCustomer, customerToForm } from "../lib/checkin.js";
import { AddressField } from "./AddressField.jsx";
import defaultLogo from "../assets/genie-logo.png";

/* Electronic signatures. A signing view shows the whole estimate or
   invoice and captures the customer's signature; the image is saved onto
   the order (order.signatures) and prints on the paperwork. A tablet
   signed in to the shop can run the signature station, which shows
   whichever ticket the front desk sends to it. */

/* A finger/stylus signature pad on a canvas. Calls onChange with a PNG
   data URL after each stroke, and "" when cleared. */
export function SignaturePad({ onChange }) {
  const ref = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);
  const dirty = useRef(false);

  useEffect(() => {
    const c = ref.current;
    const ctx = c.getContext("2d");
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, r.width) * dpr;
    c.height = Math.max(1, r.height) * dpr;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111";
    const pos = (e) => {
      const b = c.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    };
    const start = (e) => {
      e.preventDefault();
      drawing.current = true;
      last.current = pos(e);
      c.setPointerCapture?.(e.pointerId);
    };
    const move = (e) => {
      if (!drawing.current) return;
      e.preventDefault();
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last.current = p;
      dirty.current = true;
    };
    const end = () => {
      if (drawing.current && dirty.current) onChange && onChange(c.toDataURL("image/png"));
      drawing.current = false;
    };
    c.addEventListener("pointerdown", start);
    c.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    return () => {
      c.removeEventListener("pointerdown", start);
      c.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
  }, [onChange]);

  const clear = () => {
    const c = ref.current;
    c.getContext("2d").clearRect(0, 0, c.width, c.height);
    dirty.current = false;
    onChange && onChange("");
  };

  return (
    <div className="sigPad">
      <canvas ref={ref} className="sigCanvas" />
      <div className="sigBase">
        <span className="sigX">✕ Sign above</span>
        <button type="button" className="btn tiny" onClick={clear}>
          Clear
        </button>
      </div>
    </div>
  );
}

function LineRows({ order }) {
  const lines = (order.lines || []).filter((l) => l.kind !== "note" || l.description);
  const groups = [];
  for (const l of lines) {
    const g = groups[groups.length - 1];
    if (g && g.job === (l.job || "")) g.lines.push(l);
    else groups.push({ job: l.job || "", lines: [l] });
  }
  return (
    <table className="signLines">
      <tbody>
        {groups.map((g, gi) => {
          const packaged = g.lines.filter((l) => l.packaged);
          const rest0 = g.lines.filter((l) => !l.packaged);
          const pkgAmt = packaged.reduce((a, l) => a + lineAmount(l), 0);
          const pkgParts = packaged.filter((l) => l.kind === "part");
          const pkgPartIds = new Set(pkgParts.filter((l) => l.partId).map((l) => l.partId));
          const surBy = {};
          for (const l of rest0) if (l.surchargeKind === "filter" && l.surchargeForId && pkgPartIds.has(l.surchargeForId)) surBy[l.surchargeForId] = l;
          const rest = rest0.filter((l) => !(l.surchargeKind === "filter" && l.surchargeForId && pkgPartIds.has(l.surchargeForId)));
          return (
            <Fragment key={gi}>
              {packaged.length > 0 && (
                <tr>
                  <td>{g.job}</td>
                  <td className="r">{fmtMoney(pkgAmt)}</td>
                </tr>
              )}
              {pkgParts.map((l) => {
                const sur = l.partId ? surBy[l.partId] : null;
                const amt = sur ? lineAmount(sur) : 0;
                return (
                  <tr key={l.id}>
                    <td className="muted" style={{ paddingLeft: 14 }}>
                      {l.description}
                      {Number(l.qty) > 1 ? ` · ${l.qty}` : ""} · {sur ? "Filter not standard, additional charge applied" : "included"}
                    </td>
                    <td className="r muted">{fmtMoney(amt)}</td>
                  </tr>
                );
              })}
              {rest.map((l) => (
                <tr key={l.id}>
                  <td>
                    {g.job && !packaged.length ? <span className="signJob">{g.job}: </span> : null}
                    {l.description}
                    {l.kind === "part" ? <span className="muted"> ({conditionLabel(l.condition)})</span> : null}
                    {l.kind === "labor" ? <span className="muted"> · {laborQtyText(l)}</span> : l.qty > 1 ? <span className="muted"> · {l.qty}</span> : null}
                  </td>
                  <td className="r">{l.kind === "discount" ? `-${fmtMoney(lineAmount(l))}` : fmtMoney(lineAmount(l))}</td>
                </tr>
              ))}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

/* The full-screen signing view for one order. `onDone(saved)` closes it. */
export function OrderSign({ order, shop, cfg, onDone, flash }) {
  const c = shop.customers[order.customerId];
  const v = shop.vehicles[order.vehicleId];
  const t = orderTotals(order, cfg, c);
  const isInvoice = order.status === "invoiced" || order.status === "void";
  const slot = isInvoice ? "delivery" : "authorization";
  const statement = isInvoice
    ? cfg.invoiceFooter || "I have received the vehicle and a copy of the warranty."
    : cfg.authorizationText || "I authorize the work described above and the necessary materials.";
  const heading = isInvoice ? "Please review and sign for your vehicle" : "Please review and approve this estimate";
  const existing = (order.signatures || {})[slot] || {};
  const [img, setImg] = useState(existing.img || "");
  const [name, setName] = useState(existing.name || customerName(c) || "");
  const [checks, setChecks] = useState((order.authFill && order.authFill.checks) || {});
  const blanks = (order.authFill && order.authFill.blanks) || {}; // shown on the form, filled on the desk, not the pad
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!img) return flash("Please sign in the box first.", "out");
    setBusy(true);
    try {
      const at = Date.now();
      const signatures = { ...(order.signatures || {}), [slot]: { img, name: name.trim(), at } };
      await shop.saveOrder({ ...order, signatures, authFill: { checks, blanks }, history: [...(order.history || []), { at, what: `signed: ${slot === "delivery" ? "vehicle received" : "estimate approved"}` }] });
      flash("Signature saved");
      onDone(true);
    } catch (e) {
      setBusy(false);
      flash("Couldn't save the signature — try again.", "out");
      console.error("signature save failed", e);
    }
  };

  return (
    <div className="signOverlay">
      <div className="signSheet">
        <div className="signHead">
          <img src={cfg.logo || defaultLogo} alt="" />
          <div className="grow">
            <strong>{cfg.shopName}</strong>
            <div className="muted">
              {statusLabel(order.status)} #{order.number} · {fmtDate(order.invoicedAt || order.createdAt)}
            </div>
          </div>
          <button className="btn ghost" onClick={() => onDone(false)}>
            Close
          </button>
        </div>

        <h2 className="signAsk">{heading}</h2>
        <div className="signWho">
          <div>
            <strong>{customerName(c)}</strong>
            {c && c.phone ? <div className="muted">{c.phone}</div> : null}
          </div>
          <div className="r">
            <strong>{vehicleName(v)}</strong>
            {v && (v.plate || v.vin) ? <div className="muted">{[v.plate, v.vin].filter(Boolean).join(" · ")}</div> : null}
          </div>
        </div>

        {order.concern ? <p className="signConcern">You told us: {order.concern}</p> : null}

        <LineRows order={order} />

        <div className="signTotals">
          <div>
            <span>Subtotal</span>
            <span>{fmtMoney(t.subtotal)}</span>
          </div>
          <div>
            <span>Sales tax{t.taxRate ? ` (${t.taxRate}%)` : ""}</span>
            <span>{fmtMoney(t.tax)}</span>
          </div>
          <div className="grand">
            <span>Total</span>
            <span>{fmtMoney(t.total)}</span>
          </div>
          {isInvoice && owesBalance(order, t) ? (
            <div className="grand">
              <span>Balance due</span>
              <span>{fmtMoney(t.balance)}</span>
            </div>
          ) : null}
        </div>

        <div className="signStatement">
          {parseAuthText(statement).map((tk, idx) =>
            tk.type === "text" ? (
              <span key={idx}>{tk.text}</span>
            ) : tk.type === "check" ? (
              /* a big tap target, not a native checkbox — those miss taps on
                 some tablets and the checked state doesn't always show */
              <button
                key={idx}
                type="button"
                className={`authChk ${checks[tk.i] ? "on" : ""}`}
                onClick={() => setChecks((c) => ({ ...c, [tk.i]: !c[tk.i] }))}
                aria-pressed={!!checks[tk.i]}
                aria-label="checkbox"
              >
                {checks[tk.i] ? "✓" : ""}
              </button>
            ) : (
              /* the "____" lines (date, signature) are just the printed form —
                 the customer signs in the box below, so these aren't tappable */
              <span key={idx} className="authBlank">{blanks[tk.i] || " "}</span>
            )
          )}
        </div>

        <label className="fld">
          <span>Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Type your name" />
        </label>
        <div className="fld">
          <span>Signature</span>
          <SignaturePad onChange={setImg} />
        </div>

        <div className="signBtns">
          <button className="btn primary lg" onClick={save} disabled={busy || !img}>
            {isInvoice ? "Sign and finish" : "Approve and sign"}
          </button>
          <button className="btn lg" onClick={() => onDone(false)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* The signature station: leave this open on a tablet signed in to the
   shop. When the front desk sends a ticket, it appears here for the
   customer to sign; signing clears the request. */
export function SignatureStation({ shop, cfg, flash, onLock }) {
  const [reqId, setReqId] = useState(null);
  const [thanks, setThanks] = useState(null); // customer to show a receipts QR to after signing
  const [checkin, setCheckin] = useState(false); // customer is filling in their own info
  const [checkedIn, setCheckedIn] = useState(false); // just-saved confirmation
  const [infoReqId, setInfoReqId] = useState(null); // customer the desk sent to verify their info
  const [intakeOrderId, setIntakeOrderId] = useState(null); // new car the desk sent for the customer to fill in their own info
  const load = () => {
    sGet(SIGNREQ_KEY, null).then((r) => setReqId(r && r.orderId ? r.orderId : null));
    sGet(INFOREQ_KEY, null).then((r) => setInfoReqId(r && r.customerId ? r.customerId : null));
    sGet(INTAKEREQ_KEY, null).then((r) => setIntakeOrderId(r && r.orderId ? r.orderId : null));
  };
  useEffect(() => {
    load();
    return cloud.subscribe((e) => {
      if (e.type === "data" && (e.keys || []).some((k) => k === SIGNREQ_KEY || k === INFOREQ_KEY || k === INTAKEREQ_KEY)) load();
    });
  }, []);

  const order = reqId ? shop.orders[reqId] : null;
  const infoCust = infoReqId ? shop.customers[infoReqId] : null;
  const intakeOrder = intakeOrderId ? shop.orders[intakeOrderId] : null;
  const intakeVeh = intakeOrder && intakeOrder.vehicleId ? shop.vehicles[intakeOrder.vehicleId] : null;
  const clearReq = () => sDel(SIGNREQ_KEY);
  const clearInfo = () => sDel(INFOREQ_KEY);
  const clearIntake = () => sDel(INTAKEREQ_KEY);

  /* Right after they sign, the tablet shows a QR to the portal so the
     customer can pull up all their receipts before handing it back. */
  if (thanks) {
    const email = thanks && thanks.email ? String(thanks.email).trim() : "";
    return (
      <div className="deskBody">
        <div className="signWait">
          <img src={cfg.logo || defaultLogo} alt="" />
          <h1>Thank you!</h1>
          <p className="muted" style={{ maxWidth: 460, marginBottom: 8 }}>Scan to see your receipts and service history any time.</p>
          <QR value={portalUrl()} size={260} />
          {email ? (
            <p className="muted" style={{ maxWidth: 460 }}>
              Sign in with your email: <strong>{email}</strong>. First time? Tap <strong>“Email me a sign-in link.”</strong>
            </p>
          ) : null}
          <button
            className="btn primary lg"
            onClick={() => {
              setThanks(null);
              clearReq();
              setReqId(null);
            }}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  /* A customer just saved their own info — a friendly confirmation, no data shown back. */
  if (checkedIn) {
    return (
      <div className="deskBody">
        <div className="signWait">
          <img src={cfg.logo || defaultLogo} alt="" />
          <h1>You're all set!</h1>
          <p className="muted" style={{ maxWidth: 460 }}>Thanks — your details are with us. Please let our team know you've checked in.</p>
          <button className="btn primary lg" onClick={() => setCheckedIn(false)}>
            Done
          </button>
        </div>
      </div>
    );
  }

  /* The desk sent this specific customer to the tablet to check their info.
     Pre-filled, and always saved back onto that same record. */
  if (infoCust) {
    return (
      <CheckInForm
        shop={shop}
        cfg={cfg}
        flash={flash}
        verify
        lockToId={infoCust.id}
        initial={customerToForm(infoCust)}
        onCancel={() => {
          clearInfo();
          setInfoReqId(null);
        }}
        onDone={() => {
          clearInfo();
          setInfoReqId(null);
          setCheckedIn(true);
        }}
      />
    );
  }

  /* The desk sent a new car over for its customer to fill in their own info.
     Blank form; on save the new customer is linked straight to that car. */
  if (intakeOrder) {
    return (
      <CheckInForm
        shop={shop}
        cfg={cfg}
        flash={flash}
        linkVehicleId={intakeOrder.vehicleId || null}
        carLabel={intakeVeh ? [vehicleName(intakeVeh), intakeVeh.plate].filter(Boolean).join(" · ") : ""}
        onCancel={() => {
          clearIntake();
          setIntakeOrderId(null);
        }}
        onDone={() => {
          clearIntake();
          setIntakeOrderId(null);
          setCheckedIn(true);
        }}
      />
    );
  }

  /* Self-serve intake: the customer types their own name, phone, email and address. */
  if (checkin && !order) {
    return (
      <CheckInForm
        shop={shop}
        cfg={cfg}
        flash={flash}
        onCancel={() => setCheckin(false)}
        onDone={() => {
          setCheckin(false);
          setCheckedIn(true);
        }}
      />
    );
  }

  if (!order) {
    return (
      <div className="deskBody">
        <div className="signWait">
          <img src={cfg.logo || defaultLogo} alt="" />
          <h1>{cfg.shopName}</h1>
          <p className="muted">Ready to sign. When the front desk sends your estimate, it will appear here.</p>
          <button className="btn primary lg" style={{ marginTop: 18 }} onClick={() => setCheckin(true)}>
            Check in
          </button>
          {onLock && (
            <button className="btn" style={{ marginTop: 12 }} onClick={onLock} title="Hide the rest of the program behind this screen; a code gets you back">
              Lock to this screen
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <OrderSign
      order={order}
      shop={shop}
      cfg={cfg}
      flash={flash}
      onDone={(saved) => {
        clearReq();
        if (saved && order.status === "invoiced") {
          /* signed the final invoice — show the receipts QR, then Done returns to the wait screen */
          setThanks(shop.customers[order.customerId] || {});
        } else {
          setReqId(null);
        }
      }}
    />
  );
}

/* A tablet-friendly form the customer fills in themselves while they wait.
   Write-only: it never shows anything about other customers, so it's safe on
   the kiosk. Blank (self-serve) it collects a new customer and matches a
   returning one by phone + name. With `initial`/`lockToId` the desk has sent a
   known customer to verify, so it starts pre-filled and always saves back onto
   that same record. */
function CheckInForm({ shop, cfg, flash, initial, lockToId, verify, linkVehicleId, carLabel, onCancel, onDone }) {
  const [d, setD] = useState(() => initial || { first: "", last: "", phone: "", email: "", street: "", city: "", state: "CA", zip: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => {
    const v = e.target.value;
    setD((x) => ({ ...x, [k]: k === "state" ? v.toUpperCase().slice(0, 2) : v }));
    setErr("");
  };

  const save = async () => {
    if (!d.first.trim() && !d.last.trim()) return setErr("Please enter your name.");
    if (!d.phone.trim()) return setErr("Please enter a phone number so we can reach you.");
    setBusy(true);
    try {
      const now = Date.now();
      /* Only the fields the customer actually typed; a blank never wipes
         out something we already have on a returning customer. */
      const entered = {
        first: d.first.trim(),
        last: d.last.trim(),
        phone: d.phone.trim(),
        email: d.email.trim(),
        street: d.street.trim(),
        city: d.city.trim(),
        state: d.state.trim(),
        zip: d.zip.trim(),
      };
      /* When the desk sent a specific customer to verify, always save back
         onto that record. Otherwise (self-serve) match a returning customer
         on phone AND name so we update instead of duplicating — and don't
         merge two people who share a phone (a household). */
      const existing = (lockToId && shop.customers[lockToId]) || matchExistingCustomer(shop.customers, entered);
      let saved;
      if (existing) {
        const merged = { ...existing };
        for (const [k, v] of Object.entries(entered)) if (v) merged[k] = v;
        saved = await shop.saveCustomer({ ...merged, active: true, selfCheckIn: true, checkedInAt: now });
      } else {
        saved = await shop.saveCustomer({
          ...entered,
          state: entered.state || "CA",
          company: "",
          phone2: "",
          notes: "Checked in on the tablet",
          taxExempt: false,
          active: true,
          selfCheckIn: true,
          checkedInAt: now,
        });
      }
      /* The desk sent a specific car over: put this customer on it so the
         ticket links up on its own back at the counter. */
      if (linkVehicleId && saved && saved.id) {
        const veh = shop.vehicles[linkVehicleId];
        if (veh && veh.customerId !== saved.id) await shop.saveVehicle({ ...veh, customerId: saved.id });
      }
      onDone();
    } catch (e) {
      setBusy(false);
      flash && flash("Couldn't save — please try again.", "out");
      console.error("check-in save failed", e);
    }
  };

  return (
    <div className="deskBody">
      <div className="checkIn">
        <img src={cfg.logo || defaultLogo} alt="" className="checkInLogo" />
        <h1>{verify ? "Please check your details" : "Welcome — please check in"}</h1>
        <p className="muted">
          {verify ? "Update anything that's changed, then tap Save and hand the tablet back." : "Fill in your details and hand the tablet back to our team."}
        </p>
        {carLabel ? <p className="checkInCar">For your {carLabel}</p> : null}
        <div className="fldRow">
          <label className="fld">
            <span>First name</span>
            <input value={d.first} onChange={set("first")} autoFocus autoComplete="given-name" />
          </label>
          <label className="fld">
            <span>Last name</span>
            <input value={d.last} onChange={set("last")} autoComplete="family-name" />
          </label>
        </div>
        <div className="fldRow">
          <label className="fld">
            <span>Phone</span>
            <input value={d.phone} onChange={set("phone")} inputMode="tel" autoComplete="tel" placeholder="(619) 555-0100" />
          </label>
          <label className="fld">
            <span>Email</span>
            <input value={d.email} onChange={set("email")} type="email" inputMode="email" autoComplete="email" />
          </label>
        </div>
        <label className="fld">
          <span>Home address</span>
          <AddressField
            value={d.street}
            onChange={(v) => {
              setD((x) => ({ ...x, street: v }));
              setErr("");
            }}
            onPick={(a) => setD((x) => ({ ...x, street: a.street, city: a.city || x.city, state: a.state || x.state, zip: a.zip || x.zip }))}
            placeholder="Start typing your street address…"
            inputProps={{ autoComplete: "street-address" }}
          />
        </label>
        <div className="fldRow">
          <label className="fld grow">
            <span>City</span>
            <input value={d.city} onChange={set("city")} autoComplete="address-level2" />
          </label>
          <label className="fld state">
            <span>State</span>
            <input value={d.state} onChange={set("state")} autoComplete="address-level1" />
          </label>
          <label className="fld zip">
            <span>ZIP</span>
            <input value={d.zip} onChange={set("zip")} inputMode="numeric" autoComplete="postal-code" />
          </label>
        </div>
        {err && <p className="fldErr">{err}</p>}
        <div className="signBtns">
          <button className="btn primary lg" onClick={save} disabled={busy}>
            {busy ? "Saving…" : verify ? "Save" : "Submit"}
          </button>
          <button className="btn lg" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
