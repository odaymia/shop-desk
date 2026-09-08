import { useState, useEffect, useRef, useCallback } from "react";
import { uid } from "../lib/ids.js";
import {
  CUSTOMER_PREFIX,
  VEHICLE_PREFIX,
  PART_PREFIX,
  VENDOR_PREFIX,
  JOB_PREFIX,
  ORDER_PREFIX,
  SPEC_PREFIX,
  specStoreKey,
  COUNTERS_KEY,
  customerKey,
  vehicleKey,
  partKey,
  vendorKey,
  jobKey,
  orderKey,
} from "../lib/keys.js";
import { STATUS, canTransition, snapshotRules, stockMoves, round2 } from "../lib/invoice.js";
import { STARTER_JOBS } from "../lib/starterJobs.js";
import { specKey } from "../lib/specs.js";
import { cloud, sGet, sGetAll, sSet } from "../storage/index.js";

/* Front desk data: customers, vehicles, parts, vendors, canned jobs, and
   orders, each one key per record. Everything is loaded into memory at
   mount (a shop's whole history is a few thousand small records), then
   patched key by key as this device or another one writes.

   Records are never hard-deleted. Customers, vehicles, parts, vendors and
   jobs get `active: false`; orders move to `void`. History has to add up
   years later. */

const TABLES = [
  ["customers", CUSTOMER_PREFIX, customerKey],
  ["vehicles", VEHICLE_PREFIX, vehicleKey],
  ["parts", PART_PREFIX, partKey],
  ["vendors", VENDOR_PREFIX, vendorKey],
  ["jobs", JOB_PREFIX, jobKey],
  ["orders", ORDER_PREFIX, orderKey],
  ["specs", SPEC_PREFIX, specStoreKey],
];

const empty = () => ({
  customers: {},
  vehicles: {},
  parts: {},
  vendors: {},
  jobs: {},
  orders: {},
  specs: {},
  counters: {},
  loaded: false,
});

export function useShop(cfg) {
  const [data, setData] = useState(empty);
  const ref = useRef(data);
  const commit = useCallback((next) => {
    ref.current = next;
    setData(next);
  }, []);

  /* first load */
  useEffect(() => {
    let alive = true;
    (async () => {
      const next = empty();
      for (const [name, prefix] of TABLES) {
        const rows = await sGetAll(prefix);
        const map = {};
        for (const [, v] of rows) if (v && v.id) map[v.id] = v;
        next[name] = map;
      }
      next.counters = (await sGet(COUNTERS_KEY, null)) || {};
      next.loaded = true;
      if (alive) commit(next);
    })();
    return () => {
      alive = false;
    };
  }, [commit]);

  /* another device changed something: re-read just those keys */
  useEffect(
    () =>
      cloud.subscribe(async (e) => {
        if (e.type !== "data") return;
        let next = null;
        for (const key of e.keys || []) {
          for (const [name, prefix] of TABLES) {
            if (!key.startsWith(prefix)) continue;
            const v = await sGet(key, null);
            next = next || { ...ref.current };
            next[name] = { ...next[name] };
            const id = key.slice(prefix.length);
            if (v) next[name][id] = v;
            else delete next[name][id];
          }
          if (key === COUNTERS_KEY) {
            next = next || { ...ref.current };
            next.counters = (await sGet(COUNTERS_KEY, null)) || {};
          }
        }
        if (next) commit(next);
      }),
    [commit]
  );

  /* generic upsert: assigns an id, stamps updatedAt, writes, patches state */
  const put = useCallback(
    async (table, keyFn, rec) => {
      const now = Date.now();
      const saved = { ...rec, id: rec.id || uid(), updatedAt: now, createdAt: rec.createdAt || now };
      const next = { ...ref.current, [table]: { ...ref.current[table], [saved.id]: saved } };
      commit(next);
      await sSet(keyFn(saved.id), saved);
      return saved;
    },
    [commit]
  );

  /* Starter jobs the shop doesn't have yet are added once the data is in.
     If this computer is signed in, wait for the first pull so jobs another
     computer already made aren't doubled up. Jobs are never deleted (only
     retired), so a missing one can only mean it was never added. */
  useEffect(() => {
    if (!data.loaded) return;
    let done = false;
    const trySeed = async () => {
      if (done || !ref.current.loaded) return;
      const s = cloud.getState();
      if (s.linked && !s.lastSync) return;
      done = true;
      const have = Object.values(ref.current.jobs);
      for (const j of STARTER_JOBS) {
        if (have.some((x) => x.starterKey === j.starterKey || x.name === j.name)) continue;
        await put("jobs", jobKey, { ...j, active: true });
      }
    };
    trySeed();
    return cloud.subscribe((e) => (e.type === "state" || e.type === "data") && trySeed());
  }, [data.loaded, put]);

  const saveCustomer = useCallback((c) => put("customers", customerKey, c), [put]);
  const saveVehicle = useCallback((v) => put("vehicles", vehicleKey, v), [put]);
  const savePart = useCallback((p) => put("parts", partKey, p), [put]);
  const saveVendor = useCallback((v) => put("vendors", vendorKey, v), [put]);
  const saveJob = useCallback((j) => put("jobs", jobKey, j), [put]);
  const saveOrder = useCallback((o) => put("orders", orderKey, o), [put]);
  /* one spec per year/make/model/engine; the key is the id so a re-save replaces */
  const saveSpec = useCallback((sp) => put("specs", specStoreKey, { ...sp, id: specKey(sp).replace(/[^A-Za-z0-9|.-]/g, "_") }), [put]);

  /* One sequence for estimates, ROs and invoices, like a modern shop
     system: the number never changes as the ticket moves along, so the
     customer's paperwork always matches. Two devices creating tickets at
     the same second while offline could collide; the list flags a
     duplicate number if that ever happens. */
  const takeNumber = useCallback(async () => {
    const cur = ref.current.counters;
    const n = Number(cur.nextOrder) || Number(cfg.nextOrderNumber) || 1001;
    const counters = { ...cur, nextOrder: n + 1 };
    commit({ ...ref.current, counters });
    await sSet(COUNTERS_KEY, counters);
    return n;
  }, [cfg.nextOrderNumber, commit]);

  const createOrder = useCallback(
    async ({ customerId = null, vehicleId = null, status = STATUS.estimate, writerId = null } = {}) => {
      const number = await takeNumber();
      const veh = vehicleId ? ref.current.vehicles[vehicleId] : null;
      return saveOrder({
        number,
        status,
        customerId,
        vehicleId,
        mileageIn: veh && veh.mileage ? veh.mileage : "",
        mileageOut: "",
        concern: "",
        notes: "",
        writerId,
        techId: null,
        lines: [],
        payments: [],
        recommendations: [],
        stockApplied: false,
        history: [{ at: Date.now(), what: "created" }],
      });
    },
    [takeNumber, saveOrder]
  );

  /* Adjust on-hand for every inventory part on the ticket. */
  const moveStock = useCallback(
    async (order, sign) => {
      const parts = { ...ref.current.parts };
      const writes = [];
      for (const m of stockMoves(order)) {
        const p = parts[m.partId];
        if (!p) continue;
        const next = { ...p, onHand: round2((Number(p.onHand) || 0) - sign * m.qty), updatedAt: Date.now() };
        parts[m.partId] = next;
        writes.push(sSet(partKey(next.id), next));
      }
      commit({ ...ref.current, parts });
      await Promise.all(writes);
    },
    [commit]
  );

  const setStatus = useCallback(
    async (order, to, customer) => {
      if (!canTransition(order.status, to)) throw new Error(`Can't move a ${order.status} ticket to ${to}`);
      const now = Date.now();
      let next = { ...order, status: to, history: [...(order.history || []), { at: now, what: to }] };
      if (to === STATUS.open && !order.approvedAt) next.approvedAt = now;
      if (to === STATUS.invoiced) {
        next.invoicedAt = now;
        next.rules = snapshotRules(cfg, customer);
        if (!order.stockApplied) {
          await moveStock(next, +1);
          next.stockApplied = true;
        }
        /* remember the mileage on the car */
        const veh = next.vehicleId ? ref.current.vehicles[next.vehicleId] : null;
        const miles = Number(next.mileageOut || next.mileageIn);
        if (veh && miles && miles > (Number(veh.mileage) || 0)) await saveVehicle({ ...veh, mileage: miles });
      }
      if (to === STATUS.deleted) next.deletedAt = now;
      if (to === STATUS.void) {
        next.voidedAt = now;
        if (order.stockApplied) {
          await moveStock(next, -1);
          next.stockApplied = false;
        }
      }
      return saveOrder(next);
    },
    [cfg, moveStock, saveOrder, saveVehicle]
  );

  return {
    ...data,
    saveCustomer,
    saveVehicle,
    savePart,
    saveVendor,
    saveJob,
    saveOrder,
    saveSpec,
    createOrder,
    setStatus,
  };
}

/* ---------- lookups (pure) ---------- */
export const customerName = (c) => {
  if (!c) return "Walk-in";
  const n = [c.first, c.last].filter(Boolean).join(" ").trim();
  return n || c.company || "Unnamed";
};
export const vehicleName = (v) =>
  v ? [v.year, v.make, v.model, v.submodel].filter(Boolean).join(" ") || "Vehicle" : "No vehicle";
export const activeList = (map) =>
  Object.values(map || {}).filter((r) => r.active !== false);
export const vehiclesOf = (vehicles, customerId) =>
  activeList(vehicles).filter((v) => v.customerId === customerId);
/* deleted tickets are gone from every screen; the record stays behind
   only so other computers learn about the deletion */
export const isLive = (o) => o && o.status !== "deleted";
export const ordersOf = (orders, { customerId, vehicleId }) =>
  Object.values(orders || {})
    .filter(isLive)
    .filter((o) => (vehicleId ? o.vehicleId === vehicleId : o.customerId === customerId))
    .sort((a, b) => b.createdAt - a.createdAt);

export function searchText(q, ...fields) {
  const needle = String(q || "").trim().toLowerCase();
  if (!needle) return true;
  const hay = fields.filter(Boolean).join(" ").toLowerCase();
  return needle.split(/\s+/).every((w) => hay.includes(w));
}
