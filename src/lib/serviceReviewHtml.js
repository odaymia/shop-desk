/* One design for the customer Service Review, as a self-contained HTML string
   (its own <style>), so the printed handout and the online page look identical.
   Takes the payload from reviewReport(). Pure. */

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const STYLE = `
.srReport{--due:#b3261e;--soon:#b45309;--inspect:#1657d6;--done:#166534;--ink:#15181d;--muted:#5b6572;--line:#e4e7ec;
  color:var(--ink);background:#fff;max-width:760px;margin:0 auto;padding:26px 30px;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.srReport *{box-sizing:border-box;}
.srReport header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:3px solid var(--ink);padding-bottom:12px;}
.srReport .srShop{font-size:22px;font-weight:800;letter-spacing:-.01em;}
.srReport .srShopSub{font-size:12px;color:var(--muted);margin-top:3px;}
.srReport .srMeta{text-align:right;flex:none;}
.srReport .srKicker{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);}
.srReport .srDate{font-size:15px;font-weight:700;}
.srReport .srCar{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 12px;margin:14px 0 6px;}
.srReport .srCar strong{font-size:18px;}
.srReport .srCar span{color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums;}
.srReport h2.srH{font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:22px 0 10px;display:flex;align-items:center;gap:8px;}
.srReport .srCount{background:var(--due);color:#fff;border-radius:999px;font-size:12px;font-weight:800;padding:1px 9px;}
.srReport .srCards{display:flex;flex-direction:column;gap:10px;}
.srReport .srCard{border:1px solid var(--line);border-left:5px solid var(--muted);border-radius:12px;padding:13px 15px;background:#fff;break-inside:avoid;}
.srReport .srCard.due{border-left-color:var(--due);}
.srReport .srCard.soon{border-left-color:var(--soon);}
.srReport .srCardTop{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;}
.srReport .srSvc{font-weight:700;font-size:16px;}
.srReport .srPart{display:inline-block;margin-left:8px;font-weight:600;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;}
.srReport .srRight{display:flex;align-items:center;gap:10px;flex:none;}
.srReport .srPill{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.03em;padding:3px 10px;border-radius:999px;white-space:nowrap;}
.srReport .srPill.due{background:#fdecec;color:var(--due);}
.srReport .srPill.soon{background:#fdf1e3;color:var(--soon);}
.srReport .srPrice{font-weight:800;font-size:17px;font-variant-numeric:tabular-nums;}
.srReport .srWhy{margin:7px 0 0;color:var(--muted);font-size:13.5px;line-height:1.45;}
.srReport .srTotal{display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding:12px 16px;border-radius:12px;background:#f6f8fa;border:1px solid var(--line);}
.srReport .srTotal span{font-weight:600;color:var(--muted);}
.srReport .srTotal b{font-size:22px;font-variant-numeric:tabular-nums;}
.srReport .srAllGood{padding:16px;border-radius:12px;background:#eaf7ef;border:1px solid #b7e4c7;color:var(--done);font-weight:700;}
.srReport .srInspect,.srReport .srDone{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;}
.srReport .srInspect li,.srReport .srDone li{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--line);font-size:14px;}
.srReport .srDone li{color:var(--done);}
.srReport .srInspect li span,.srReport .srDone li span{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums;font-weight:400;}
.srReport .srFoot{margin-top:22px;padding-top:12px;border-top:1px solid var(--line);font-size:12px;color:var(--muted);line-height:1.55;}
@media (max-width:520px){.srReport{padding:18px 16px;}.srReport header{flex-direction:column;}.srReport .srMeta{text-align:left;}.srReport .srInspect,.srReport .srDone{grid-template-columns:1fr;}.srReport .srCardTop{flex-direction:column;}.srReport .srRight{gap:8px;}}
`;

function card(s) {
  return `<div class="srCard ${esc(s.tone)}">
    <div class="srCardTop">
      <div class="srSvc">${esc(s.name)}${s.partNumber ? `<span class="srPart">Part #${esc(s.partNumber)}</span>` : ""}</div>
      <div class="srRight"><span class="srPill ${esc(s.tone)}">${esc(s.statusLabel)}</span>${s.priceText ? `<span class="srPrice">${esc(s.priceText)}</span>` : ""}</div>
    </div>
    ${s.why ? `<p class="srWhy">${esc(s.why)}</p>` : ""}
  </div>`;
}

/* The report body as HTML. Includes its own <style>, so it renders the same in
   the print sheet and the public page. */
export function reviewReportHtml(p) {
  if (!p) return "";
  const idBits = [p.plate ? `Plate ${esc(p.plate)}` : "", p.vin ? `VIN ${esc(p.vin)}` : ""].filter(Boolean).join(" · ");
  const rec = p.recommended || [];
  const insp = p.inspect || [];
  const done = p.upToDate || [];
  return `<style>${STYLE}</style>
<div class="srReport">
  <header>
    <div>
      <div class="srShop">${esc(p.shopName || "Service Review")}</div>
      <div class="srShopSub">${[p.shopAddress, p.shopPhone, p.website].filter(Boolean).map(esc).join(" · ")}</div>
    </div>
    <div class="srMeta"><div class="srKicker">Service Review</div><div class="srDate">${esc(p.date || "")}</div></div>
  </header>
  <div class="srCar"><strong>${esc(p.vehicle || "Your vehicle")}</strong><span>${[idBits, p.mileageText].filter(Boolean).join(" · ")}</span></div>

  ${
    rec.length
      ? `<h2 class="srH">Recommended for your car <span class="srCount">${rec.length}</span></h2>
         <div class="srCards">${rec.map(card).join("")}</div>
         ${p.recommendedTotal ? `<div class="srTotal"><span>Estimated total if done today</span><b>${esc(p.recommendedTotalText)}</b></div>` : ""}`
      : `<div class="srAllGood">✓ Everything looks up to date — nothing is due right now.</div>`
  }

  ${
    insp.length
      ? `<h2 class="srH">We'll keep an eye on these</h2>
         <ul class="srInspect">${insp.map((s) => `<li>${esc(s.name)}${s.priceText ? `<span>${esc(s.priceText)}</span>` : ""}</li>`).join("")}</ul>`
      : ""
  }

  ${
    done.length
      ? `<h2 class="srH">Up to date — nice work</h2>
         <ul class="srDone">${done.map((s) => `<li>✓ ${esc(s.name)}${s.lastDone ? `<span>last done ${esc(s.lastDone)}</span>` : ""}</li>`).join("")}</ul>`
      : ""
  }

  <p class="srFoot">Questions about anything here? Call us${p.shopPhone ? ` at ${esc(p.shopPhone)}` : ""}. Recommendations are based on your vehicle's maintenance schedule and its service history with us. Prices are estimates and are confirmed before any work is done.</p>
</div>`;
}
