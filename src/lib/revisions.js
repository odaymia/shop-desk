/* Invoice/estimate revisions. A revision is a point-in-time snapshot of the
   ticket — its lines, concern, status, and totals — with a note about what
   changed. The writer takes one whenever they change an estimate (add a job,
   adjust a price, re-quote) so there's a record of what the customer saw at
   each step. Pure — no React, no storage. */

import { orderTotals } from "./invoice.js";

export function makeRevision(order, cfg, customer, note) {
  const t = orderTotals(order, cfg, customer);
  return {
    id: "rev_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    at: Date.now(),
    note: String(note || "").trim(),
    status: order.status,
    subtotal: t.subtotal,
    total: t.total,
    concern: order.concern || "",
    lines: JSON.parse(JSON.stringify(order.lines || [])),
  };
}

export function withRevision(order, rev) {
  return { ...order, revisions: [...(order.revisions || []), rev] };
}

export function revisionCount(order) {
  return ((order && order.revisions) || []).length;
}

/* What changed between two revisions' line sets, in plain counts. */
export function revisionDelta(prevRev, rev) {
  const prev = (prevRev && prevRev.lines) || [];
  const cur = (rev && rev.lines) || [];
  return {
    addedLines: Math.max(0, cur.length - prev.length),
    removedLines: Math.max(0, prev.length - cur.length),
    totalChange: Math.round(((rev.total || 0) - (prevRev ? prevRev.total || 0 : 0)) * 100) / 100,
  };
}
