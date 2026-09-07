/* Tire helpers. Pure — no React, no storage. */

/* "225/65r17", "225 65 17", "P225/65R17" all become 225/65R17 */
export const normalizeTireSize = (v) => {
  const t = String(v || "").toUpperCase().replace(/\s+/g, "");
  const m = t.match(/^[PLT]*(\d{3})[/-]?\/?(\d{2,3})[/-]?Z?R?(\d{2}(?:\.\d)?)(C?)$/);
  if (m) return `${m[1]}/${m[2]}R${m[3]}${m[4]}`;
  const f = t.match(/^(\d{2})X(\d{1,2}(?:\.\d{1,2})?)R?(\d{2})(LT)?$/); // flotation: 31X10.50R15
  return f ? `${f[1]}X${f[2]}R${f[3]}${f[4] || ""}` : t;
};
export const isTireSize = (v) => /^(\d{3}\/\d{2,3}R\d{2}(\.\d)?C?|\d{2}X\d{1,2}(\.\d{1,2})?R\d{2}(LT)?)$/.test(String(v || ""));

/* sort key so 205/55R16 lands before 225/65R17: rim, then width, then sidewall */
export const tireSizeKey = (v) => {
  const m = String(v || "").match(/^(\d{3})\/(\d{2,3})R(\d{2}(?:\.\d)?)/);
  return m ? [Number(m[3]), Number(m[1]), Number(m[2])] : [999, 0, 0];
};

/* Imported tires carry one description like "Ironman, iMOVE GEN 3 AS";
   split it into brand and model when the record has no brand of its own. */
export const tireBrandModel = (p) => {
  if (p.brand || p.model) return { brand: p.brand || "", model: p.model || "" };
  const d = String(p.description || "");
  const i = d.indexOf(",");
  if (i > 0) return { brand: d.slice(0, i).trim(), model: d.slice(i + 1).trim() };
  const parts = d.split(" ");
  return { brand: parts[0] || "", model: parts.slice(1).join(" ") };
};
export const tireName = (p) => {
  const { brand, model } = tireBrandModel(p);
  return [brand, model].filter(Boolean).join(" ") || p.description || "Tire";
};
