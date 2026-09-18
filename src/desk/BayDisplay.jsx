import { useEffect, useState } from "react";
import { cloud, sGet } from "../storage/index.js";
import { bayReqKey } from "../lib/keys.js";
import { bayCard } from "../lib/bay.js";
import { vehicleName } from "./useShop.js";
import defaultLogo from "../assets/genie-logo.png";

/* The shop-floor bay screen. A tablet by the bays runs this and shows — in
   big letters — the work on whatever car the front desk sent. One screen can
   watch a single bay full-size, or several bays side by side (say a big TV
   over the shop floor). The choice is remembered on the device. */
const LS_KEY = "sd.bayDisplayIds"; // JSON array of bay ids
const OLD_KEY = "sd.bayDisplayId"; // the earlier single-bay key, migrated in

const readBays = () => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.filter(Boolean);
    }
    const old = localStorage.getItem(OLD_KEY);
    return old ? [old] : [];
  } catch {
    return [];
  }
};
const writeBays = (ids) => {
  try {
    if (ids && ids.length) localStorage.setItem(LS_KEY, JSON.stringify(ids));
    else localStorage.removeItem(LS_KEY);
    localStorage.removeItem(OLD_KEY);
  } catch {
    /* private window / blocked storage — the choice just won't persist */
  }
};

export function BayDisplay({ shop, cfg }) {
  const bays = cfg.bays || [];
  const [chosenIds, setChosenIds] = useState(readBays);
  /* keep the order the bays are listed in settings, and drop any that were
     removed there since this device last chose */
  const chosen = bays.filter((b) => chosenIds.includes(b.id)).map((b) => b.id);
  const [picking, setPicking] = useState(false);
  const [temp, setTemp] = useState([]);
  const [reqIds, setReqIds] = useState({}); // bayId -> orderId on that bay

  const watchKey = chosen.join(",");

  useEffect(() => {
    const ids = watchKey ? watchKey.split(",") : [];
    if (!ids.length) return;
    const mine = {};
    ids.forEach((id) => (mine[bayReqKey(id)] = true));
    const load = () =>
      Promise.all(
        ids.map((id) => sGet(bayReqKey(id), null).then((r) => [id, r && r.orderId ? r.orderId : null])),
      ).then((pairs) => setReqIds(Object.fromEntries(pairs)));
    load();
    return cloud.subscribe((e) => {
      if (e.type === "data" && (e.keys || []).some((k) => mine[k])) load();
    });
  }, [watchKey]);

  const startPick = () => {
    setTemp(chosen);
    setPicking(true);
  };
  const toggle = (id) => setTemp((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  const confirm = () => {
    const ordered = bays.filter((b) => temp.includes(b.id)).map((b) => b.id);
    writeBays(ordered);
    setChosenIds(ordered);
    setPicking(false);
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

  if (picking || !chosen.length)
    return (
      <div className="deskBody">
        <div className="bayPick">
          <h1>Which bays should this screen show?</h1>
          <p className="muted">
            Pick one for a full-screen bay, or several to watch side by side. Remembered on this device.
          </p>
          <div className="bayPickGrid">
            {bays.map((b) => {
              const on = temp.includes(b.id);
              return (
                <button key={b.id} className={`btn lg ${on ? "primary" : ""}`} onClick={() => toggle(b.id)}>
                  {on ? "✓ " : ""}
                  {b.name}
                </button>
              );
            })}
          </div>
          <div className="rowBtns" style={{ marginTop: 18 }}>
            <button className="btn primary" disabled={!temp.length} onClick={confirm}>
              {temp.length > 1 ? `Show these ${temp.length} bays` : "Show bay"}
            </button>
            {!!chosen.length && (
              <button className="btn" onClick={() => setPicking(false)}>
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    );

  const chosenBays = bays.filter((b) => chosen.includes(b.id));
  const multi = chosenBays.length > 1;
  const orderFor = (b) => (reqIds[b.id] ? shop.orders[reqIds[b.id]] : null);

  return (
    <div className={`bayScreen ${multi ? "bayMulti" : ""}`}>
      <div className="bayTop">
        <span className="bayName">{multi ? `${chosenBays.length} bays` : chosenBays[0].name}</span>
        <button className="linkish" onClick={startPick}>
          Change
        </button>
      </div>
      {multi ? (
        <div className="bayGrid">
          {chosenBays.map((b) => (
            <BayPanel key={b.id} bay={b} shop={shop} order={orderFor(b)} compact />
          ))}
        </div>
      ) : (
        <BayPanel bay={chosenBays[0]} shop={shop} order={orderFor(chosenBays[0])} cfg={cfg} />
      )}
    </div>
  );
}

/* One bay's card — full-screen on its own, or a tile in the grid (compact). */
function BayPanel({ bay, shop, order, compact, cfg }) {
  const card = order ? bayCard(order) : null;
  const veh = order ? shop.vehicles[order.vehicleId] : null;

  return (
    <div className={`bayPanel ${compact ? "compact" : ""}`}>
      {compact && <div className="bayPanelName">{bay.name}</div>}
      {!order || !card ? (
        <div className="bayIdle">
          {!compact && <img src={(cfg && cfg.logo) || defaultLogo} alt="" />}
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
