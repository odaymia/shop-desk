import { useMemo } from "react";
import { Modal, Money, fmtDate, toNum } from "./ui.jsx";
import { uid } from "../lib/ids.js";
import { rotationCompliance } from "../lib/tireService.js";

/* Quick tire-rotation builder: one tap drops a rotation on the ticket, and it
   shows how often this car has been rotated and when it's due again — staying
   on schedule is what keeps the road-hazard warranty valid. */

/* the shop's rotation price: its "Tire rotation…" canned job if it has one,
   else a sensible default */
function rotationPrice(shop) {
  for (const j of Object.values(shop.jobs || {})) {
    if (j && j.active !== false && /rotat/i.test(j.name || "")) {
      const labor = (j.lines || []).find((l) => l.kind === "labor" && Number(l.rate) > 0);
      if (labor) return Number(labor.rate);
    }
  }
  return 29.99;
}

const STATUS = {
  none: { label: "First rotation here", cls: "soon" },
  ok: { label: "On schedule", cls: "soon" },
  soon: { label: "Due soon", cls: "due" },
  overdue: { label: "Overdue", cls: "due" },
};

export function RotationBuilder({ shop, cfg, order, onAdd, onClose }) {
  const currentMileage = toNum(order.mileageIn) || toNum(order.mileageOut);
  const orders = shop.orders;
  const jobs = shop.jobs;
  const comp = useMemo(
    () => rotationCompliance({ orders, vehicleId: order.vehicleId, cfg, now: Date.now(), currentMileage }),
    [orders, order.vehicleId, cfg, currentMileage]
  );
  const price = useMemo(() => rotationPrice(shop), [jobs]); // eslint-disable-line react-hooks/exhaustive-deps
  const st = STATUS[comp.status] || STATUS.none;
  const mi = (n) => `${Math.round(n).toLocaleString()} mi`;

  const dueText = () => {
    if (!comp.count) return "No rotation on file yet — this is the first one.";
    const bits = [];
    if (comp.nextDueMileage) bits.push(comp.dueByMiles != null ? (comp.dueByMiles >= 0 ? `${mi(comp.dueByMiles)} to go` : `${mi(-comp.dueByMiles)} over`) : `at ${mi(comp.nextDueMileage)}`);
    if (comp.nextDueAt) bits.push(comp.dueByDays != null ? (comp.dueByDays >= 0 ? `${comp.dueByDays} days` : `${-comp.dueByDays} days over`) : fmtDate(comp.nextDueAt));
    return bits.join(" · ");
  };

  const add = () => {
    onAdd({
      id: uid(),
      kind: "labor",
      description: "Tire rotation and balance",
      details: `Rotate and balance all four tires. Keeps the road hazard warranty valid — rotate about every ${comp.intervalMiles.toLocaleString()} mi or ${comp.intervalMonths} months.`,
      hours: 1,
      rate: price,
      unit: "service",
      techId: null,
      taxable: false,
      job: "Tire rotation",
    });
    onClose();
  };

  return (
    <Modal title="Tire rotation" onClose={onClose} size="wide">
      <div className="statRow">
        <div className="stat">
          <span>Rotations on file</span>
          <strong>{comp.count}</strong>
          {comp.lastAt ? <small style={{ color: "var(--muted)" }}>last {fmtDate(comp.lastAt)}{comp.lastMileage ? ` · ${mi(comp.lastMileage)}` : ""}</small> : null}
        </div>
        <div className="stat">
          <span>Status</span>
          <strong>
            <span className={`svcBadge ${st.cls}`}>{st.label}</span>
          </strong>
          {comp.avgMiles ? <small style={{ color: "var(--muted)" }}>about every {mi(comp.avgMiles)}</small> : comp.avgDays ? <small style={{ color: "var(--muted)" }}>about every {comp.avgDays} days</small> : null}
        </div>
        <div className="stat">
          <span>Next due</span>
          <strong style={{ fontSize: 15 }}>{dueText()}</strong>
          <small style={{ color: "var(--muted)" }}>every {comp.intervalMiles.toLocaleString()} mi or {comp.intervalMonths} mo</small>
        </div>
      </div>

      {comp.status === "overdue" && (
        <p className="legalNote" style={{ marginTop: 0, color: "var(--warn)" }}>
          This car is past its rotation interval. Rotating today brings it back into compliance with the road hazard warranty.
        </p>
      )}
      {!currentMileage && comp.count > 0 && (
        <p className="legalNote" style={{ marginTop: 0 }}>Enter the mileage on the ticket to show the exact miles-to-go.</p>
      )}

      {comp.history.length > 0 && (
        <div className="card" style={{ marginTop: 8 }}>
          <div className="cardHead">
            <h3>Rotation history</h3>
          </div>
          <table className="dk">
            <thead>
              <tr>
                <th>Date</th>
                <th>Mileage</th>
                <th>Invoice</th>
              </tr>
            </thead>
            <tbody>
              {[...comp.history].reverse().slice(0, 12).map((h, i) => (
                <tr key={h.number || i}>
                  <td className="muted">{fmtDate(h.at)}</td>
                  <td className="muted num">{h.mileage ? mi(h.mileage) : "—"}</td>
                  <td className="muted num">#{h.number}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rowBtns" style={{ marginTop: 14 }}>
        <button className="btn primary lg" onClick={add}>
          Add tire rotation — <Money v={price} />
        </button>
        <button className="btn lg" onClick={onClose}>
          Cancel
        </button>
      </div>
      <p className="legalNote">Rotating on schedule (every {comp.intervalMiles.toLocaleString()} mi or {comp.intervalMonths} months) keeps the road hazard warranty valid. Change the interval under Settings → Tire warranties &amp; rotation.</p>
    </Modal>
  );
}
