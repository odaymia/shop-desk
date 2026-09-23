/* The public vehicle-inspection page. Opened from the link the shop texts the
   customer: loads the inspection snapshot by token and shows it — color-coded
   results, notes, photos, and recommended work. Read-only; the token in the URL
   is the key. Talks only to the "sign" Edge Function. `?t=demo` shows a sample. */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../lib/cloudConfig.js";

const FN = `${SUPABASE_URL}/functions/v1/sign`;
const app = document.getElementById("app");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (n) => "$" + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);

const STATE = {
  good: { cls: "good", label: "Good" },
  advise: { cls: "advise", label: "Attention" },
  fail: { cls: "fail", label: "Needs service" },
  na: { cls: "na", label: "N/A" },
};

async function get(token) {
  const res = await fetch(FN, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify({ action: "get", token }),
  });
  let data = {};
  try {
    data = await res.json();
  } catch { /* ignore */ }
  return { ok: res.ok, data };
}

function centered(html) {
  app.className = "";
  app.innerHTML = `<div class="sheet"><div class="center">${html}</div></div>`;
}
const fail = (msg) => centered(`<h1>Can't open this</h1><p class="err">${esc(msg)}</p>`);

function render(p) {
  const badge = (s) => {
    const st = STATE[s] || STATE.na;
    return `<span class="badge ${st.cls}">${esc(st.label)}</span>`;
  };
  const photos = (list) =>
    (list || []).length ? `<div class="photos">${list.map((src) => `<img loading="lazy" src="${esc(src)}" alt="" />`).join("")}</div>` : "";
  const item = (it) => `
    <div class="item">
      <div class="itemHead">${badge(it.status)}<span class="ilabel">${esc(it.label)}</span></div>
      ${it.note ? `<p class="inote">${esc(it.note)}</p>` : ""}
      ${photos(it.photos)}
    </div>`;
  const cat = (c) => `<div class="cat"><h3>${esc(c.name)}</h3>${(c.items || []).map(item).join("")}</div>`;

  const recs = p.recommendations || [];
  const recTotal = recs.reduce((a, r) => a + (Number(r.price) || 0), 0);
  const recsHtml = recs.length
    ? `<div class="recs"><h3>Recommended work</h3>
        ${recs.map((r) => `<div class="rec"><span>${esc(r.label)}</span><span class="amt">${r.price ? money(r.price) : ""}</span></div>`).join("")}
        ${recTotal ? `<div class="rectot"><span>Estimated total</span><span>${money(recTotal)}</span></div>` : ""}
        <p class="inote" style="margin-top:10px">Questions or want to approve this work? Give us a call.</p>
      </div>`
    : "";

  app.className = "";
  app.innerHTML = `
    <div class="sheet">
      <div class="head">
        <div class="shop">${esc(p.shopName || "Your shop")}</div>
        <div class="meta">${[p.shopPhone, p.at ? new Date(p.at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : ""].filter(Boolean).map(esc).join(" · ")}</div>
        <div class="ttl">Vehicle inspection${p.number ? ` · #${esc(p.number)}` : ""}${p.vehicle ? ` · ${esc(p.vehicle)}` : ""}</div>
      </div>
      <div class="legend">
        <b class="g"><span class="dot g"></span>Good</b>
        <b class="a"><span class="dot a"></span>Attention</b>
        <b class="f"><span class="dot f"></span>Needs service</b>
      </div>
      ${(p.categories || []).map(cat).join("")}
      ${recsHtml}
      <div class="foot">Thank you for trusting ${esc(p.shopName || "us")} with your vehicle.</div>
    </div>`;

  // photo lightbox
  const lb = document.getElementById("lightbox");
  const lbImg = document.getElementById("lightboxImg");
  app.querySelectorAll(".photos img").forEach((img) => {
    img.addEventListener("click", () => {
      lbImg.src = img.src;
      lb.classList.add("on");
    });
  });
  lb.addEventListener("click", () => lb.classList.remove("on"));
}

function demo() {
  return {
    kind: "inspection",
    shopName: "Genie Auto Center",
    shopPhone: "619-312-2480",
    number: "13579",
    vehicle: "2016 Chevrolet Tahoe",
    at: Date.now(),
    categories: [
      { name: "Under hood", items: [
        { label: "Engine oil level & condition", status: "good" },
        { label: "Battery & terminals", status: "advise", note: "Battery tested weak — 480 CCA of 650. Recommend replacement soon.", photos: [] },
        { label: "Engine air filter", status: "fail", note: "Heavily clogged.", photos: [] },
      ] },
      { name: "Brakes", items: [
        { label: "Front pads & rotors", status: "fail", note: "Pads at 2mm, rotors scored.", photos: [] },
        { label: "Rear pads & rotors", status: "good" },
      ] },
      { name: "Tires & wheels", items: [
        { label: "LF tire tread & condition", status: "advise", note: "4/32\" — approaching replacement." },
        { label: "Tire pressure set to spec", status: "good" },
      ] },
    ],
    recommendations: [
      { label: "Front brake service", price: 320 },
      { label: "Engine air filter replacement", price: 45 },
      { label: "Battery replacement", price: 210 },
    ],
  };
}

const token = new URLSearchParams(location.search).get("t");
(async () => {
  if (!token) return fail("This link is missing its code. Please ask the shop to resend it.");
  if (token === "demo") return render(demo());
  try {
    const { ok, data } = await get(token);
    if (!ok || !data || !data.payload) return fail((data && data.error) || "This link is no longer valid.");
    render(data.payload);
  } catch {
    fail("Couldn't load the inspection. Please check your connection and try again.");
  }
})();
