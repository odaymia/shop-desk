/* How a staff name appears on printed tickets. Pure. */

export const NAME_MODES = [
  ["off", "Don't print names"],
  ["full", "Full name (Sam Garcia)"],
  ["first-initial", "First name and last initial (Sam G.)"],
  ["initials", "Initials only (S.G.)"],
];

export function staffLabel(name, mode) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.replace(/\.$/, ""));
  if (!parts.length || mode === "off") return "";
  if (mode === "initials") return parts.map((p) => p[0].toUpperCase() + ".").join("");
  if (mode === "first-initial") return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
  return parts.join(" ");
}

/* A real customer name has actual letters — not the placeholder symbols
   (".", ",", "'") a counter types to satisfy a system that demands a name,
   and not a number. A person's first/last can't have digits; a company
   may (e.g. "A1 Towing"). Returns an error to show, or "" when it passes.
   Blank fields are fine — a walk-in has no name. */
export function realNameError(c) {
  const hasLetter = (s) => /[A-Za-z]/.test(s);
  const check = (v, label, allowDigits) => {
    const s = String(v || "").trim();
    if (!s) return "";
    if (!hasLetter(s)) return `${label} needs actual letters, not just symbols or numbers.`;
    if (!allowDigits && /\d/.test(s)) return `${label} shouldn't contain numbers.`;
    return "";
  };
  return (
    check((c || {}).first, "First name", false) ||
    check((c || {}).last, "Last name", false) ||
    check((c || {}).company, "Company", true)
  );
}
