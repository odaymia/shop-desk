import { useState, useEffect, useCallback } from "react";
import { Money, fmtDateTime, fmtPhone } from "./ui.jsx";
import { cloud } from "../storage/index.js";

/* Online tire orders and quotes that came in from the shop's TireConnect
   widget (website or in-app). Each one lists what the customer picked;
   "Build ticket" turns it into a tires ticket with the lines already on it,
   matching or creating the customer. "Dismiss" just hides it. Nothing is
   deleted. Set up under Settings -> Website -> TireConnect. */

const eventLabel = (e) => {
  const s = String(e || "");
  if (s.startsWith("order")) return "Online order";
  if (s.startsWith("lead")) return "Quote request";
  return "Tire request";
};

export function TireOrders({ flash, onBuild, onChange }) {
  const [orders, setOrders] = useState(null); // null = loading
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    cloud
      .listTireOrders()
      .then((r) => setOrders(r || []))
      .catch(() => setOrders([]));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const build = async (o) => {
    setBusy(o.id);
    try {
      await onBuild(o);
      setOrders((rs) => (rs || []).filter((r) => r.id !== o.id));
      if (onChange) onChange();
    } catch (e) {
      flash(e.message || "Couldn't build the ticket", "out");
    } finally {
      setBusy(null);
    }
  };
  const dismiss = async (id) => {
    await cloud.handleTireOrder(id, null);
    setOrders((rs) => (rs || []).filter((r) => r.id !== id));
    if (onChange) onChange();
  };

  const linked = cloud.getState().linked;

  return (
    <>
      <header className="deskHead">
        <h1>Tire orders</h1>
        {orders && orders.length > 0 && <span className="navCount">{orders.length}</span>}
        <div className="grow" />
        <button className="btn" onClick={load}>
          Refresh
        </button>
      </header>
      <div className="deskBody" style={{ maxWidth: 820 }}>
        <p className="legalNote" style={{ marginTop: 0 }}>
          Orders and quotes customers built on your TireConnect tire widget. Build each into a ticket, or dismiss it.
          Connect it under Settings → Website → TireConnect.
        </p>

        {orders === null ? (
          <p className="emptyNote">Loading…</p>
        ) : !linked ? (
          <p className="emptyNote">Orders come in once this computer is signed in to your shop and TireConnect is connected.</p>
        ) : orders.length === 0 ? (
          <p className="emptyNote">No new tire orders right now. New ones show up here with a count on the menu.</p>
        ) : (
          orders.map((o) => {
            const tires = (o.quote && o.quote.tires) || [];
            return (
              <div key={o.id} className="card apptCard">
                <div className="apptTop">
                  <div>
                    <b className="apptName">{o.customer_name || "Online customer"}</b>
                    <span className="apptWhen">
                      {eventLabel(o.event)} · {fmtDateTime(new Date(o.created_at).getTime())}
                    </span>
                  </div>
                  <div className="rowBtns">
                    {o.customer_phone && (
                      <a className="btn tiny" href={`tel:${o.customer_phone.replace(/[^\d+]/g, "")}`}>
                        Call
                      </a>
                    )}
                    <button className="btn tiny primary" disabled={busy === o.id} onClick={() => build(o)}>
                      {busy === o.id ? "Building…" : "Build ticket"}
                    </button>
                    <button className="btn tiny" disabled={busy === o.id} onClick={() => dismiss(o.id)}>
                      Dismiss
                    </button>
                  </div>
                </div>

                <dl className="kv apptKv">
                  {o.customer_phone && (
                    <>
                      <dt>Phone</dt>
                      <dd>{fmtPhone(o.customer_phone)}</dd>
                    </>
                  )}
                  {o.customer_email && (
                    <>
                      <dt>Email</dt>
                      <dd>{o.customer_email}</dd>
                    </>
                  )}
                  {o.vehicle && (
                    <>
                      <dt>Vehicle</dt>
                      <dd>{o.vehicle}</dd>
                    </>
                  )}
                  {o.total != null && (
                    <>
                      <dt>Their total</dt>
                      <dd>
                        <Money v={o.total} />
                      </dd>
                    </>
                  )}
                </dl>

                {tires.length > 0 && (
                  <div className="apptNote">
                    <span className="apptNoteLabel">Tires</span>
                    {tires.map((t, i) => (
                      <div key={i}>
                        {t.quantity || 1}× {[t.brand_name, t.model_name].filter(Boolean).join(" ")} {t.size}
                        {t.price != null ? (
                          <>
                            {" "}
                            — <Money v={t.price} /> each
                          </>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
