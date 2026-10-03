/* Product editions. The same codebase ships as separate products — each one
   focused on a single trade — so a quick-lube shop isn't shown mechanical
   tools it doesn't use. The edition decides which departments exist; the
   mechanical and tire work stays in the code, lit up by the edition (or by
   turning its department on). Pure: no React, no storage. */

export const EDITIONS = {
  quicklube: { id: "quicklube", name: "Bolt Badger QuickLube OS", short: "QuickLube OS", depts: ["oil"], tagline: "Oil changes, done right." },
  tire: { id: "tire", name: "Bolt Badger Tire OS", short: "Tire OS", depts: ["tires"], tagline: "Tires, quoted and sold." },
  mechanical: { id: "mechanical", name: "Bolt Badger Mechanical OS", short: "Mechanical OS", depts: ["mech"], tagline: "Repairs, written right." },
  full: { id: "full", name: "Bolt Badger Shop OS", short: "Shop OS", depts: ["oil", "tires", "mech"], tagline: "The whole shop, one ticket." },
};

/* The shop's edition, defaulting to the full shop for anything unrecognized so
   a shop is never accidentally stripped of a department it was using. */
export function editionOf(cfg) {
  return EDITIONS[(cfg && cfg.edition) || ""] || EDITIONS.full;
}

/* The department ids this edition runs. */
export const editionDeptIds = (cfg) => editionOf(cfg).depts;

/* A single-trade edition (QuickLube / Tire / Mechanical) vs. the full shop. */
export const isSingleEdition = (cfg) => editionOf(cfg).depts.length === 1;
