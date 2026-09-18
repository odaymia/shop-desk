/* Worker commissions. A quick-lube ticket is run by three people — the
   advisor on the computer (who greets, writes, and upsells), the top tech
   over the hood, and the pit tech under the car — and each commissionable
   service on the ticket pays a flat spiff that's split among the three by a
   share the shop sets once.

   Commission amounts live on the service: on each canned job (`job.commission`)
   and on each oil-change package (`pkg.commission`). A blank or zero pays
   nothing (so the base oil change can pay $0 while the upsells pay). Pure
   functions — no React, DOM, or storage. */

import { lineAmount } from "./invoice.js";

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const norm = (s) => String(s || "").trim().toLowerCase();

/* One service's commission, split per role. A service's `commission` is
   either a flat number (the old spiff, divided by the shop's global split),
   or a per-role object { advisor, top, pit } where each role is
   { mode: "amt" | "pct", value } — a fixed dollar amount, or a percent of
   that service's own revenue on the ticket. */
export function serviceCommission(commission, revenue, split) {
  if (commission && typeof commission === "object") {
    const role = (r) => {
      const c = commission[r];
      const v = c ? Number(c.value) || 0 : 0;
      if (!v) return 0;
      return c.mode === "pct" ? round2((v / 100) * (Number(revenue) || 0)) : round2(v);
    };
    const advisor = role("advisor");
    const top = role("top");
    const pit = role("pit");
    return { advisor, top, pit, total: round2(advisor + top + pit) };
  }
  const total = Number(commission) || 0;
  if (!total) return { advisor: 0, top: 0, pit: 0, total: 0 };
  return { ...splitCommission(total, split), total };
}

export const COMM_ROLES = [
  ["advisor", "Advisor"],
  ["top", "Top tech"],
  ["pit", "Pit tech"],
];

/* A service's stored commission → the per-role form shape the editor uses.
   A legacy flat number becomes fixed per-role amounts split by the shop's
   global split, so an existing service's payout is preserved on first edit. */
export function commToForm(commission, split) {
  const blank = () => ({ advisor: { mode: "amt", value: "" }, top: { mode: "amt", value: "" }, pit: { mode: "amt", value: "" } });
  if (commission && typeof commission === "object") {
    const out = {};
    for (const [r] of COMM_ROLES) out[r] = { mode: commission[r] && commission[r].mode === "pct" ? "pct" : "amt", value: commission[r] && commission[r].value != null ? commission[r].value : "" };
    return out;
  }
  const n = Number(commission) || 0;
  if (n > 0) {
    const s = { advisor: Number(split && split.advisor) || 0, top: Number(split && split.top) || 0, pit: Number(split && split.pit) || 0 };
    const sum = s.advisor + s.top + s.pit;
    if (sum > 0)
      return {
        advisor: { mode: "amt", value: round2((n * s.advisor) / sum) },
        top: { mode: "amt", value: round2((n * s.top) / sum) },
        pit: { mode: "amt", value: round2((n * s.pit) / sum) },
      };
    return { ...blank(), advisor: { mode: "amt", value: round2(n) } };
  }
  return blank();
}

/* The editor's shape back to storage: a per-role object, or null when every
   role is blank/zero. An untouched legacy number or string passes through as
   its number (or null). */
export function commFromForm(c) {
  if (c == null) return null;
  if (typeof c === "number") return c || null;
  if (typeof c === "string") return Number(c.replace(/[^0-9.]/g, "")) || null;
  const out = {};
  let any = false;
  for (const [r] of COMM_ROLES) {
    const raw = c[r] ? c[r].value : "";
    const num = raw === "" || raw == null ? 0 : Number(String(raw).replace(/[^0-9.]/g, "")) || 0;
    if (num > 0) {
      out[r] = { mode: c[r].mode === "pct" ? "pct" : "amt", value: num };
      any = true;
    }
  }
  return any ? out : null;
}

/* The three people on a ticket, newest field names first and the older
   single-tech fields as a fallback so tickets written before this feature
   still resolve. */
export function orderCrew(order) {
  return {
    advisorId: (order && (order.advisorId || order.writerId)) || null,
    topId: (order && (order.topTechId || order.techId)) || null,
    pitId: (order && order.pitTechId) || null,
  };
}

/* Total commission a ticket generates, and the services that made it up. Each
   distinct service on the ticket pays once; an oil package wins over a canned
   job of the same name. Lines with no service (à la carte parts) pay nothing. */
export function commissionForOrder(order, jobs, packages, split) {
  const pkgBy = {};
  for (const p of Object.values(packages || {})) if (p && p.name) pkgBy[norm(p.name)] = p.commission;
  const jobBy = {};
  for (const j of Object.values(jobs || {})) if (j && j.name) jobBy[norm(j.name)] = j.commission;
  /* revenue per service on this ticket, for percentage commissions */
  const revBy = {};
  for (const l of (order && order.lines) || []) {
    const k = norm(l.job || "");
    if (!k) continue;
    revBy[k] = round2((revBy[k] || 0) + (l.kind === "discount" ? -lineAmount(l) : lineAmount(l)));
  }
  const seen = new Set();
  let total = 0;
  let advisor = 0;
  let top = 0;
  let pit = 0;
  const items = [];
  for (const l of (order && order.lines) || []) {
    const name = (l.job || "").trim();
    if (!name) continue;
    const key = norm(name);
    if (seen.has(key)) continue;
    seen.add(key);
    const comm = key in pkgBy ? pkgBy[key] : key in jobBy ? jobBy[key] : null;
    const c = serviceCommission(comm, revBy[key] || 0, split);
    if (c.total) {
      total = round2(total + c.total);
      advisor = round2(advisor + c.advisor);
      top = round2(top + c.top);
      pit = round2(pit + c.pit);
      items.push({ service: name, amount: c.total, advisor: c.advisor, top: c.top, pit: c.pit });
    }
  }
  return { total, advisor, top, pit, items };
}

/* Divide a commission among the three roles by the shop's split. The split
   values are shares (they need not sum to 100 — they're normalized), and any
   rounding remainder goes to the advisor so the parts always add to the whole. */
export function splitCommission(total, split) {
  const s = split || {};
  const pa = Number(s.advisor) || 0;
  const pt = Number(s.top) || 0;
  const pp = Number(s.pit) || 0;
  const sum = pa + pt + pp;
  if (!total || sum <= 0) return { advisor: 0, top: 0, pit: 0 };
  const top = round2((total * pt) / sum);
  const pit = round2((total * pp) / sum);
  const advisor = round2(total - top - pit);
  return { advisor, top, pit };
}

/* The commission a single ticket pays out, per person. */
export function orderPayout(order, jobs, packages, split) {
  const { total, advisor, top, pit } = commissionForOrder(order, jobs, packages, split);
  return { total, advisor, top, pit, crew: orderCrew(order) };
}

/* Roll commissions up per employee across a set of orders (pass the invoiced
   ones for a date range). Returns a map of employee id → their earnings by
   role, and the grand total of commission generated (including any share for a
   role left unassigned, which is counted in `grand` but paid to no one). */
export function commissionByEmployee(orders, jobs, packages, split) {
  const by = {};
  let grand = 0;
  let paid = 0;
  for (const o of orders || []) {
    const { total, advisor, top, pit } = commissionForOrder(o, jobs, packages, split);
    if (!total) continue;
    grand = round2(grand + total);
    const crew = orderCrew(o);
    const add = (id, role, amt) => {
      if (!id || !amt) return;
      by[id] = by[id] || { advisor: 0, top: 0, pit: 0, total: 0, tickets: new Set() };
      by[id][role] = round2(by[id][role] + amt);
      by[id].total = round2(by[id].total + amt);
      by[id].tickets.add(o.id);
      paid = round2(paid + amt);
    };
    add(crew.advisorId, "advisor", advisor);
    add(crew.topId, "top", top);
    add(crew.pitId, "pit", pit);
  }
  return { by, grand, paid };
}
