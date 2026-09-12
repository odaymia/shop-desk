import { useRef, useEffect, useState } from "react";
import { fmtDate } from "./ui.jsx";
import { fmtMoney, orderTotals, lineAmount, laborQtyText, conditionLabel, statusLabel, owesBalance } from "../lib/invoice.js";
import { customerName, vehicleName } from "./useShop.js";
import { cloud, sGet, sDel } from "../storage/index.js";
import { SIGNREQ_KEY } from "../lib/keys.js";
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
          const rest = g.lines.filter((l) => !l.packaged);
          const pkgAmt = packaged.reduce((a, l) => a + lineAmount(l), 0);
          return (
            <tr key={gi} style={{ display: "contents" }}>
              {packaged.length > 0 && (
                <tr>
                  <td>{g.job}</td>
                  <td className="r">{fmtMoney(pkgAmt)}</td>
                </tr>
              )}
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
            </tr>
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
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!img) return flash("Please sign in the box first.", "out");
    setBusy(true);
    const at = Date.now();
    const signatures = { ...(order.signatures || {}), [slot]: { img, name: name.trim(), at } };
    await shop.saveOrder({ ...order, signatures, history: [...(order.history || []), { at, what: `signed: ${slot === "delivery" ? "vehicle received" : "estimate approved"}` }] });
    flash("Signature saved");
    onDone(true);
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

        <p className="signStatement">{statement}</p>

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
export function SignatureStation({ shop, cfg, flash }) {
  const [reqId, setReqId] = useState(null);
  const load = () => sGet(SIGNREQ_KEY, null).then((r) => setReqId(r && r.orderId ? r.orderId : null));
  useEffect(() => {
    load();
    return cloud.subscribe((e) => {
      if (e.type === "data" && (e.keys || []).includes(SIGNREQ_KEY)) load();
    });
  }, []);

  const order = reqId ? shop.orders[reqId] : null;
  const clearReq = () => sDel(SIGNREQ_KEY);

  if (!order) {
    return (
      <div className="deskBody">
        <div className="signWait">
          <img src={cfg.logo || defaultLogo} alt="" />
          <h1>{cfg.shopName}</h1>
          <p className="muted">Ready to sign. When the front desk sends your estimate, it will appear here.</p>
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
      onDone={() => {
        clearReq();
      }}
    />
  );
}
