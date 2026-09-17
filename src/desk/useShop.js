import { useState, useEffect, useRef, useCallback } from "react";
import { uid } from "../lib/ids.js";
import {
  CUSTOMER_PREFIX,
  VEHICLE_PREFIX,
  PART_PREFIX,
  VENDOR_PREFIX,
  JOB_PREFIX,
  COUPON_PREFIX,
  ORDER_PREFIX,
  SPEC_PREFIX,
  specStoreKey,
  COUNTERS_KEY,
  customerKey,
  vehicleKey,
  partKey,
  vendorKey,
  jobKey,
  couponKey,
  orderKey,
} from "../lib/keys.js";
import { STATUS, canTransition, snapshotRules, stockMoves, round2 } from "../lib/invoice.js";
import { STARTER_JOBS } from "../lib/starterJobs.js";
import { specKey } from "../lib/specs.js";
import { portalPayload, shopPublicPayload } from "../lib/portal.js";
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
  ["coupons", COUPON_PREFIX, couponKey],
  ["orders", ORDER_PREFIX, orderKey],
  ["specs", SPEC_PREFIX, specStoreKey],
];

const empty = () => ({
  customers: {},
  vehicles: {},
  parts: {},
  vendors: {},
  jobs: {},
  coupons: {},
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

  /* First load. A full shop is tens of thousands of records; reading them
     all before showing anything froze the tab for many seconds. So load a
     table at a time, in pages that yield between them (sGetAll does the
     yielding), and commit as each table lands — the lookup tables come
     first so names resolve, then the big orders table streams in with the
     ticket counts climbing as it goes. The tab stays responsive throughout. */
  useEffect(() => {
    let alive = true;
    (async () => {
      const acc = empty();
      const snapshot = () => ({ ...acc });
      for (const [name, prefix] of TABLES) {
        const map = {};
        acc[name] = map;
        let sinceCommit = 0;
        await sGetAll(prefix, (chunk) => {
          for (const [, v] of chunk) if (v && v.id) map[v.id] = v;
          sinceCommit += chunk.length;
          if (alive && sinceCommit >= 20000) {
            sinceCommit = 0;
            commit(snapshot()); // show progress on a huge table without spamming renders
          }
        });
        if (!alive) return;
        commit(snapshot());
      }
      acc.counters = (await sGet(COUNTERS_KEY, null)) || {};
      acc.loaded = true;
      if (alive) commit(snapshot());
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
        /* Pull carries the new values on the event; fall back to a read
           only if they aren't there. On a shop's first sync this batch can
           be a thousand keys, so re-reading each one would double the work
           that already just landed in IndexedDB. */
        const vals = e.values || null;
        const valueFor = async (key) => (vals && key in vals ? vals[key] : await sGet(key, null));
        let next = null;
        const cloned = {}; // clone each table map once per batch, not once per key
        for (const key of e.keys || []) {
          for (const [name, prefix] of TABLES) {
            if (!key.startsWith(prefix)) continue;
            const v = await valueFor(key);
            next = next || { ...ref.current };
            if (!cloned[name]) {
              next[name] = { ...next[name] };
              cloned[name] = true;
            }
            const id = key.slice(prefix.length);
            if (v) next[name][id] = v;
            else delete next[name][id];
          }
          if (key === COUNTERS_KEY) {
            next = next || { ...ref.current };
            next.counters = (await valueFor(COUNTERS_KEY)) || {};
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

  /* Save many records into one table in a single state commit (one render),
     then persist each. Used by bulk import — saving hundreds of parts one at
     a time re-renders the whole list on every save and crawls. */
  const putMany = useCallback(
    async (table, keyFn, recs) => {
      const now = Date.now();
      const saved = recs.map((r) => ({ ...r, id: r.id || uid(), updatedAt: now, createdAt: r.createdAt || now }));
      const map = { ...ref.current[table] };
      for (const s of saved) map[s.id] = s;
      commit({ ...ref.current, [table]: map });
      for (const s of saved) await sSet(keyFn(s.id), s);
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

  /* customer portal: one row per customer with an email, rebuilt from
     the current records whenever something they'd see changes */
  const publishCustomer = useCallback(
    (customerId) => {
      const d = ref.current;
      const c = d.customers[customerId];
      if (!c || !cfg.portalEnabled) return;
      const email = String(c.email || "").trim().toLowerCase();
      if (!email) return;
      const data = portalPayload({ customer: c, vehicles: Object.values(d.vehicles), orders: Object.values(d.orders), specs: d.specs, parts: d.parts, cfg, jobs: d.jobs });
      cloud.publishPortal(customerId, email, String(c.phone || "").replace(/\D/g, ""), data).catch((e) => console.error("portal publish failed", e));
    },
    [cfg]
  );
  const publishShop = useCallback(() => {
    if (!cfg.portalEnabled) return;
    const d = ref.current;
    cloud.publishShop(shopPublicPayload(cfg, d.jobs, d.parts)).catch((e) => console.error("shop publish failed", e));
  }, [cfg]);

  const saveCustomer = useCallback(async (c) => {
    const saved = await put("customers", customerKey, c);
    publishCustomer(saved.id);
    return saved;
  }, [put, publishCustomer]);
  const saveVehicle = useCallback(async (v) => {
    const saved = await put("vehicles", vehicleKey, v);
    if (saved.customerId) publishCustomer(saved.customerId);
    return saved;
  }, [put, publishCustomer]);
  const savePart = useCallback((p) => put("parts", partKey, p), [put]);
  const savePartsBulk = useCallback((list) => putMany("parts", partKey, list), [putMany]);
  const saveVendor = useCallback((v) => put("vendors", vendorKey, v), [put]);
  const saveJob = useCallback(async (j) => {
    const saved = await put("jobs", jobKey, j);
    if (saved.portal || (j.id && ref.current.jobs[j.id] && ref.current.jobs[j.id].portal !== saved.portal)) publishShop();
    return saved;
  }, [put, publishShop]);
  const saveCoupon = useCallback((c) => put("coupons", couponKey, c), [put]);
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
      return saveOrder({
        number,
        status,
        customerId,
        vehicleId,
        mileageIn: "", // entered fresh at the counter, not prefilled from the car's last visit
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
      if (to === STATUS.open) {
        if (!order.approvedAt) next.approvedAt = now;
        /* reopening a posted invoice: undo the post so re-posting is clean
           — put the stock back and let it price live again while edited */
        if (order.status === STATUS.invoiced) {
          if (order.stockApplied) {
            await moveStock(next, -1);
            next.stockApplied = false;
          }
          next.invoicedAt = null;
          next.rules = null;
        }
      }
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
      const saved = await saveOrder(next);
      if ((to === STATUS.invoiced || to === STATUS.void) && saved.customerId) publishCustomer(saved.customerId);
      return saved;
    },
    [cfg, moveStock, saveOrder, saveVehicle, publishCustomer]
  );

  /* everything at once, for switching the portal on or after an import */
  const publishAll = useCallback(async () => {
    const d = ref.current;
    let n = 0;
    for (const c of Object.values(d.customers)) {
      if (c.active === false || !String(c.email || "").trim()) continue;
      publishCustomer(c.id);
      n++;
    }
    publishShop();
    return n;
  }, [publishCustomer, publishShop]);

  return {
    ...data,
    saveCustomer,
    saveVehicle,
    savePart,
    savePartsBulk,
    saveVendor,
    saveJob,
    saveCoupon,
    saveOrder,
    saveSpec,
    createOrder,
    setStatus,
    publishShop,
    publishAll,
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
