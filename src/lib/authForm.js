/* The authorization text a shop writes can contain fill-in fields:
   checkboxes written as "[ ]" and blanks written as runs of underscores.
   This turns the text into tokens so the signing view can render them as
   tappable checkboxes and inputs, and the printout can show the answers.
   Pure — no React. */

/* Tokens: {type:"text",text} | {type:"check",i} | {type:"blank",i}, where
   i is the running index within checks / within blanks. */
export function parseAuthText(text) {
  const s = String(text || "");
  const tokens = [];
  const re = /\[\s?\]|_{2,}/g; // "[ ]" or "[]", or two-or-more underscores
  let last = 0;
  let ci = 0;
  let bi = 0;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > last) tokens.push({ type: "text", text: s.slice(last, m.index) });
    if (m[0][0] === "[") tokens.push({ type: "check", i: ci++ });
    else tokens.push({ type: "blank", i: bi++, width: m[0].length });
    last = m.index + m[0].length;
  }
  if (last < s.length) tokens.push({ type: "text", text: s.slice(last) });
  return tokens;
}

export function authCounts(text) {
  const t = parseAuthText(text);
  return { checks: t.filter((x) => x.type === "check").length, blanks: t.filter((x) => x.type === "blank").length };
}
