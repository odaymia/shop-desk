/* The page an email's "Unsubscribe" link opens. It asks the email function
   to stop marketing email to that address (the link carries a signed token,
   so nobody can unsubscribe someone else). A button, not an automatic
   request, so mail scanners that open links don't unsubscribe people. */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../lib/cloudConfig.js";

const card = document.getElementById("card");
const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const token = new URLSearchParams(location.search).get("u") || "";
const show = (html) => (card.innerHTML = html);

if (!token) show("<h1>Link not valid</h1><p>Reply to the email you got and we'll take you off the list.</p>");
else {
  show('<h1>Unsubscribe?</h1><p>You won\'t get specials or reminders by email anymore.</p><button id="go">Unsubscribe me</button>');
  document.getElementById("go").onclick = async () => {
    show("<h1>One moment…</h1>");
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ action: "unsubscribe", token }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "");
      show(`<h1>You're unsubscribed</h1><p>${esc(out.email)} won't get marketing email${out.shop ? ` from ${esc(out.shop)}` : ""} anymore.</p><p>You'll still get messages about work on your car, like estimates and receipts.</p>`);
    } catch (e) {
      show(`<h1>That didn't go through</h1><p>${esc(e.message) || "Please try again in a minute, or reply to the email and we'll take you off the list."}</p>`);
    }
  };
}
