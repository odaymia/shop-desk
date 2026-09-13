/* Worker commissions. A quick-lube ticket is run by three people — the
   advisor on the computer (who greets, writes, and upsells), the top tech
   over the hood, and the pit tech under the car — and each commissionable
   service on the ticket pays a flat spiff that's split among the three by a
   share the shop sets once.

   Commission amounts live on the service: on each canned job (`job.commission`)
   and on each oil-change package (`pkg.commission`). A blank or zero pays
   nothing (so the base oil change can pay $0 while the upsells pay). Pure
   functions — no React, DOM, or storage. */

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const norm = (s) => String(s || "").trim().toLowerCase();

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
export function commissionForOrder(order, jobs, packages) {
  const pkgBy = {};
  for (const p of Object.values(packages || {})) if (p && p.name) pkgBy[norm(p.name)] = Number(p.commission) || 0;
  const jobBy = {};
  for (const j of Object.values(jobs || {})) if (j && j.name) jobBy[norm(j.name)] = Number(j.commission) || 0;
  const seen = new Set();
  let total = 0;
  const items = [];
  for (const l of (order && order.lines) || []) {
    const name = (l.job || "").trim();
    if (!name) continue;
    const key = norm(name);
    if (seen.has(key)) continue;
    seen.add(key);
    const amt = key in pkgBy ? pkgBy[key] : key in jobBy ? jobBy[key] : 0;
    if (amt) {
      total = round2(total + amt);
      items.push({ service: name, amount: amt });
    }
  }
  return { total, items };
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
  const { total } = commissionForOrder(order, jobs, packages);
  return { total, ...splitCommission(total, split), crew: orderCrew(order) };
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
    const { total } = commissionForOrder(o, jobs, packages);
    if (!total) continue;
    grand = round2(grand + total);
    const s = splitCommission(total, split);
    const crew = orderCrew(o);
    const add = (id, role, amt) => {
      if (!id || !amt) return;
      by[id] = by[id] || { advisor: 0, top: 0, pit: 0, total: 0, tickets: new Set() };
      by[id][role] = round2(by[id][role] + amt);
      by[id].total = round2(by[id].total + amt);
      by[id].tickets.add(o.id);
      paid = round2(paid + amt);
    };
    add(crew.advisorId, "advisor", s.advisor);
    add(crew.topId, "top", s.top);
    add(crew.pitId, "pit", s.pit);
  }
  return { by, grand, paid };
}
