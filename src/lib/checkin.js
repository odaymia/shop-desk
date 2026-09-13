/* Customer self-check-in and "verify your info" helpers. Pure functions —
   no React, DOM, or storage — so the tablet form and its tests share them. */

/* The last 10 digits of a phone number, so formatting and a leading 1 don't
   stop two copies of the same number from matching. */
export const phoneDigits = (s) => String(s || "").replace(/\D/g, "").slice(-10);

/* Find the returning customer a check-in belongs to, or null. Matches on
   phone (either number on file) AND name: when both first and last are given
   they must both agree, so two people sharing a house phone stay separate;
   when only one name part is given, that part must agree. */
export function matchExistingCustomer(customers, entered) {
  const dig = phoneDigits(entered.phone);
  if (dig.length < 7) return null;
  const fn = String(entered.first || "").trim().toLowerCase();
  const ln = String(entered.last || "").trim().toLowerCase();
  const nameOk = (c) => {
    const cf = String(c.first || "").trim().toLowerCase();
    const cl = String(c.last || "").trim().toLowerCase();
    const fOk = !!fn && fn === cf;
    const lOk = !!ln && ln === cl;
    return fn && ln ? fOk && lOk : fOk || lOk;
  };
  return (
    Object.values(customers).find(
      (c) => c && c.active !== false && (phoneDigits(c.phone) === dig || phoneDigits(c.phone2) === dig) && nameOk(c)
    ) || null
  );
}

/* Turn a stored customer into the flat shape the check-in form edits. */
export function customerToForm(c) {
  return {
    first: c.first || "",
    last: c.last || "",
    phone: c.phone || "",
    email: c.email || "",
    street: c.street || "",
    city: c.city || "",
    state: c.state || "CA",
    zip: c.zip || "",
  };
}
