import { useEffect, useState } from "react";
import { cloud, sGet } from "../storage/index.js";
import { bayReqKey } from "../lib/keys.js";
import { bayCard } from "../lib/bay.js";
import { vehicleName } from "./useShop.js";
import defaultLogo from "../assets/genie-logo.png";

/* The shop-floor bay screen. A tablet by the bays runs this, picks which bay
   it is (remembered on the device), and shows — in big letters — the work on
   whatever car the front desk sent to that bay. */
const LS_KEY = "sd.bayDisplayId";
const readBay = () => {
  try {
    return localStorage.getItem(LS_KEY) || "";
  } catch {
    return "";
  }
};
const writeBay = (id) => {
  try {
    if (id) localStorage.setItem(LS_KEY, id);
    else localStorage.removeItem(LS_KEY);
  } catch {
    /* private window / blocked storage — the choice just won't persist */
  }
};

export function BayDisplay({ shop, cfg }) {
  const bays = cfg.bays || [];
  const [bayId, setBayId] = useState(readBay);
  const bay = bays.find((b) => b.id === bayId);
  const curBayId = bay ? bay.id : null;
  const [reqId, setReqId] = useState(null);

  useEffect(() => {
    if (!curBayId) return;
    const key = bayReqKey(curBayId);
    const load = () => sGet(key, null).then((r) => setReqId(r && r.orderId ? r.orderId : null));
    load();
    return cloud.subscribe((e) => {
      if (e.type === "data" && (e.keys || []).some((k) => k === key)) load();
    });
  }, [curBayId]);

  const pick = (id) => {
    writeBay(id);
    setBayId(id);
  };

  if (!bays.length)
    return (
      <div className="deskBody">
        <div className="bayIdle">
          <img src={cfg.logo || defaultLogo} alt="" />
          <p>No work areas set up yet. Add your bays under Settings → Company info → Work areas.</p>
        </div>
      </div>
    );

  if (!bay)
    return (
      <div className="deskBody">
        <div className="bayPick">
          <h1>Which screen is this?</h1>
          <p className="muted">Pick the bay this tablet sits in. It's remembered on this device.</p>
          <div className="bayPickGrid">
            {bays.map((b) => (
              <button key={b.id} className="btn primary lg" onClick={() => pick(b.id)}>
                {b.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    );

  const order = reqId ? shop.orders[reqId] : null;
  const card = order ? bayCard(order) : null;
  const veh = order ? shop.vehicles[order.vehicleId] : null;

  return (
    <div className="bayScreen">
      <div className="bayTop">
        <span className="bayName">{bay.name}</span>
        <button className="linkish" onClick={() => pick("")}>
          Change bay
        </button>
      </div>
      {!order || !card ? (
        <div className="bayIdle">
          <img src={cfg.logo || defaultLogo} alt="" />
          <p>Waiting for the next car…</p>
        </div>
      ) : (
        <div className="bayCar">
          <div className="bayVeh">
            {veh ? vehicleName(veh) : "Vehicle"}
            {veh && veh.plate ? ` · ${veh.plate}` : ""}
          </div>
          {card.oil && (
            <div className="bayOil">
              <div className="bayLabel">OIL CHANGE — OIL</div>
              <div className="bayBig">{card.oil.type || "—"}</div>
              <div className="bayOilStats">
                <div className="bayStat">
                  <span>Quarts</span>
                  <b>{card.oil.quarts != null ? card.oil.quarts : "—"}</b>
                </div>
                <div className="bayStat">
                  <span>Oil filter</span>
                  <b>{card.oil.filter || "—"}</b>
                </div>
              </div>
            </div>
          )}
          {card.services.length > 0 && (
            <div className="baySvc">
              <div className="bayLabel">Work on this car</div>
              <ul>
                {card.services.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
