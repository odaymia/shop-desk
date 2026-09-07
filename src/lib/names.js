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
