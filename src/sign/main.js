/* The remote-sign page. Opened from the link the shop texts the customer:
   loads the estimate/invoice snapshot by token, shows it, captures a
   signature, and sends it back. No sign-in — the token in the URL is the key.
   Talks only to the "sign" Edge Function, never the database directly. */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../lib/cloudConfig.js";

const FN = `${SUPABASE_URL}/functions/v1/sign`;
const app = document.getElementById("app");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (n) => "$" + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);

async function call(payload) {
  const res = await fetch(FN, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify(payload),
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  return { ok: res.ok, status: res.status, data };
}

function centered(html) {
  app.className = "";
  app.innerHTML = `<div class="sheet"><div class="center">${html}</div></div>`;
}

function fail(msg) {
  centered(`<h1>Can't open this</h1><p class="err">${esc(msg)}</p>`);
}

function done() {
  centered(`<div class="okmark">✓</div><h1>Thank you!</h1><p>Your signature has been received. You can close this page.</p>`);
}

const token = new URLSearchParams(location.search).get("t");

async function boot() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return fail("This shop isn't set up for remote signing yet.");
  if (!token) return fail("This link is missing its code. Please ask the shop to resend it.");
  const { ok, data } = await call({ action: "get", token });
  if (!ok || !data.payload) return fail(data.error || "This link is no longer valid.");
  if (data.status === "signed") return done();
  render(data.payload);
}

function render(p) {
  const lines = (p.lines || [])
    .map(
      (l) => `<tr><td>${esc(l.label)}${l.sub ? `<div class="sub">${esc(l.sub)}</div>` : ""}</td><td class="amt">${l.discount ? "-" : ""}${money(l.amount)}</td></tr>`
    )
    .join("");
  app.className = "";
  app.innerHTML = `
    <div class="sheet">
      <div class="head">
        <div class="shop">${esc(p.shopName || "Your shop")}</div>
        <div class="meta">${esc([p.shopAddress, p.shopPhone].filter(Boolean).join(" · "))}</div>
        <div class="ttl">${esc(p.heading || "Please review and sign")} — #${esc(p.number || "")}${p.dateText ? " · " + esc(p.dateText) : ""}</div>
      </div>
      <div class="who">
        <div><strong>${esc(p.customerName || "")}</strong>${p.customerPhone ? esc(p.customerPhone) : ""}</div>
        <div class="r"><strong>${esc(p.vehicleName || "")}</strong>${p.vehicleSub ? esc(p.vehicleSub) : ""}</div>
      </div>
      ${p.concern ? `<div class="concern"><strong>You told us:</strong> ${esc(p.concern)}</div>` : ""}
      <table><tbody>${lines}</tbody></table>
      <div class="totals">
        <div class="row"><span>Subtotal</span><span>${money(p.subtotal)}</span></div>
        <div class="row"><span>${esc(p.taxLabel || "Sales tax")}</span><span>${money(p.tax)}</span></div>
        <div class="row grand"><span>Total</span><span>${money(p.total)}</span></div>
        ${p.balance ? `<div class="row grand"><span>Balance due</span><span>${money(p.balance)}</span></div>` : ""}
      </div>
      ${p.statement ? `<div class="statement">${esc(p.statement)}</div>` : ""}
      <div class="signwrap">
        <div class="signlabel">Sign below</div>
        <div class="pad">
          <canvas id="pad"></canvas>
          <div class="padbase"><span>✕ Sign with your finger</span><button type="button" class="link" id="clear">Clear</button></div>
        </div>
        <div class="namerow"><input id="name" placeholder="Type your name" value="${esc(p.customerName || "")}" /></div>
        <button class="btn primary" id="submit" disabled>${esc(p.kind === "invoice" ? "Sign & finish" : "Approve & sign")}</button>
      </div>
    </div>`;
  wirePad(p);
}

function wirePad(p) {
  const canvas = document.getElementById("pad");
  const submit = document.getElementById("submit");
  const ctx = canvas.getContext("2d");
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, r.width) * dpr;
  canvas.height = Math.max(1, r.height) * dpr;
  ctx.scale(dpr, dpr);
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#111";
  let drawing = false,
    dirty = false,
    last = null;
  const pos = (e) => {
    const b = canvas.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    drawing = true;
    last = pos(e);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    e.preventDefault();
    const q = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
    last = q;
    dirty = true;
    submit.disabled = false;
  });
  window.addEventListener("pointerup", () => (drawing = false));
  document.getElementById("clear").addEventListener("click", () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    dirty = false;
    submit.disabled = true;
  });
  submit.addEventListener("click", async () => {
    if (!dirty) return;
    submit.disabled = true;
    submit.textContent = "Sending…";
    const img = canvas.toDataURL("image/png");
    const name = (document.getElementById("name").value || "").trim();
    const { ok, data } = await call({ action: "submit", token, signature: { img, name } });
    if (ok && data.ok) done();
    else {
      submit.disabled = false;
      submit.textContent = p.kind === "invoice" ? "Sign & finish" : "Approve & sign";
      alert(data.error || "Something went wrong. Please try again.");
    }
  });
}

boot();
