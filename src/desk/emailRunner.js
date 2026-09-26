/* Runs the automatic emails from the desk: once a day, work out who's due
   (src/lib/emailAutomations.js), write that day's copy of each email, and
   hand the list to the email function, which skips anyone unsubscribed or
   already sent that email and sends the rest. Every 15 minutes while the
   desk is open it also nudges the function to send anything queued (a
   scheduled campaign, or what was over yesterday's daily limit). */
import { cloud } from "../storage/index.js";
import { dueAutomations, automationsOf, AUTOMATION_INFO } from "../lib/emailAutomations.js";
import { composeEmail } from "../lib/emailCompose.js";
import { duePostcards } from "../lib/postcards.js";
import { sitePayload } from "../lib/website.js";
import defaultLogo from "../assets/genie-logo.png";

/* The service menu with prices and page addresses, for Services blocks */
export function emailServices(shop, cfg) {
  try {
    return sitePayload({ cfg, jobs: shop.jobs, parts: shop.parts, coupons: {}, orders: {}, specs: {}, today: new Date().toISOString().slice(0, 10) }).services;
  } catch {
    return [];
  }
}

export const emailOpts = () => ({ appBase: new URL("./", window.location.href).href, logoUrl: new URL(defaultLogo, window.location.href).href });

const RAN_KEY = "bb:emailAutoRan";
const today = () => new Date().toISOString().slice(0, 10);
const lsGet = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private window */
  }
};

export const anyAutomationOn = (cfg) => Object.values(automationsOf(cfg)).some((a) => a.on);

/* → { thanks: { found, queued }, ... } */
export async function runAutomations(shop, cfg) {
  const [signups, supp] = await Promise.all([cloud.listSiteSignups().catch(() => []), cloud.listSuppressions()]);
  const due = dueAutomations({ cfg, customers: shop.customers, vehicles: shop.vehicles, orders: shop.orders, signups, suppressed: new Set(supp.map((s) => s.email)) });
  const byKind = {};
  for (const d of due) (byKind[d.kind] = byKind[d.kind] || []).push(d);
  const auto = automationsOf(cfg);
  const result = {};
  for (const [kind, list] of Object.entries(byKind)) {
    const msg = composeEmail(cfg, shop.coupons, auto[kind], { ...emailOpts(), services: emailServices(shop, cfg) });
    const id = await cloud.saveEmailMessage({ kind, name: AUTOMATION_INFO[kind].title, subject: msg.subject, html: msg.html, text: msg.text });
    const out = await cloud.invoke("email", { action: "queue", messageId: id, recipients: list.map((d) => ({ email: d.email, vars: d.vars, dedupe: d.dedupe })) });
    result[kind] = { found: list.length, queued: out.queued || 0 };
  }
  lsSet(RAN_KEY, today());
  return result;
}

/* the daily check: at most once a day per computer (the function's dedupe
   covers two computers running it the same day) */
export async function dailyEmailTick(shop, cfg) {
  if (!cloud.getState().linked || !anyAutomationOn(cfg)) return null;
  if (lsGet(RAN_KEY) === today()) return null;
  return runAutomations(shop, cfg);
}

export async function drainTick() {
  if (!cloud.getState().linked) return null;
  return cloud.invoke("email", { action: "drain" }).catch(() => null);
}

/* The weekly postcard reminder: how many cards are waiting to be approved,
   once a shop mails postcards (it has postcard settings or has mailed
   before) and it's been about a week since the last batch. → { count } or null */
export async function postcardsWaiting(shop, cfg) {
  if (!cloud.getState().linked) return null;
  let keys;
  try {
    keys = await cloud.listMailKeys();
  } catch {
    return null; // postcards aren't set up
  }
  const sends = await cloud.listMailSends(1);
  if (!cfg.mail && !sends.length) return null;
  const last = sends[0] ? Date.parse(sends[0].created_at) : 0;
  if (last && Date.now() - last < 6 * 86400000) return null; // mailed this week already
  const batch = duePostcards({ cfg, customers: shop.customers, vehicles: shop.vehicles, orders: shop.orders, mailed: new Set(keys) });
  return batch.length ? { count: batch.length } : null;
}
