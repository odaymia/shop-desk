/* Products ("programs"). The same codebase ships as separate products — each
   one focused on a single trade — so a quick-lube shop isn't shown mechanical
   tools it doesn't use. Each program is sold on its own, but a shop can own
   any combination of them, and every program reads the SAME customer book,
   ticket history and database: a customer who buys tires and gets oil changes
   has one record, visible from whichever programs the shop runs. The mechanical
   and tire work always stays in the code, lit up by the programs a shop owns
   (or by turning a department on). Pure: no React, no storage. */

/* The three sellable programs. Each runs one department. */
export const PROGRAMS = {
  quicklube: { id: "quicklube", dept: "oil", name: "Bolt Badger QuickLube OS", short: "QuickLube OS", tagline: "Oil changes, done right." },
  tire: { id: "tire", dept: "tires", name: "Bolt Badger Tire Center OS", short: "Tire Center OS", tagline: "Tires, quoted and sold." },
  mechanical: { id: "mechanical", dept: "mech", name: "Bolt Badger Mechanical OS", short: "Mechanical OS", tagline: "Repairs, written right." },
};
export const PROGRAM_LIST = [PROGRAMS.quicklube, PROGRAMS.tire, PROGRAMS.mechanical];
const ALL = PROGRAM_LIST.map((p) => p.id);

/* Branding when a shop owns more than one program: the whole shop, one ticket. */
const SHOP = { id: "full", name: "Bolt Badger Shop OS", short: "Shop OS", tagline: "The whole shop, one ticket." };

/* Legacy single-value cfg.edition → the programs it means. Kept so shops saved
   before programs became a set keep exactly what they had. */
const LEGACY = { quicklube: ["quicklube"], tire: ["tire"], mechanical: ["mechanical"], full: ALL };

/* The programs this shop owns, in canonical order, de-duped, never empty.
   cfg.programs (an array) wins; otherwise the legacy cfg.edition; otherwise the
   full shop, so a shop is never accidentally stripped of a department it used. */
export function ownedPrograms(cfg) {
  const raw = cfg && Array.isArray(cfg.programs) ? cfg.programs : cfg && cfg.edition ? LEGACY[cfg.edition] : null;
  const want = new Set((raw || ALL).filter((id) => PROGRAMS[id]));
  const out = ALL.filter((id) => want.has(id));
  return out.length ? out : ALL;
}

/* The department ids the owned programs run. */
export const editionDeptIds = (cfg) => ownedPrograms(cfg).map((id) => PROGRAMS[id].dept);

/* How the app is branded for this shop: a single owned program shows that
   product's name and tagline; owning more than one shows the full Shop OS. */
export function editionOf(cfg) {
  const owned = ownedPrograms(cfg);
  if (owned.length === 1) {
    const p = PROGRAMS[owned[0]];
    return { id: p.id, name: p.name, short: p.short, tagline: p.tagline, depts: [p.dept], programs: owned };
  }
  return { ...SHOP, depts: editionDeptIds(cfg), programs: owned };
}

/* A single-program shop (QuickLube / Tire Center / Mechanical) vs. the full shop. */
export const isSingleEdition = (cfg) => ownedPrograms(cfg).length === 1;

/* Back-compat for anything still importing EDITIONS (e.g. a saved-settings
   screen): the four classic products as a map. */
export const EDITIONS = {
  quicklube: { ...PROGRAMS.quicklube, depts: ["oil"] },
  tire: { ...PROGRAMS.tire, depts: ["tires"] },
  mechanical: { ...PROGRAMS.mechanical, depts: ["mech"] },
  full: { ...SHOP, depts: ALL.map((id) => PROGRAMS[id].dept) },
};
