import { useEffect } from "react";
import { fmtMoney, laborQtyText, lineAmount, orderTotals, statusLabel, conditionLabel, owesBalance } from "../lib/invoice.js";
import { customerName, vehicleName } from "./useShop.js";
import { fmtDate, fmtPhone } from "./ui.jsx";
import defaultLogo from "../assets/genie-logo.png";
import { staffLabel } from "../lib/names.js";
import { checklistSummary, recommendedServices } from "../lib/checklist.js";
import { parseAuthText } from "../lib/authForm.js";

/* The paper copy. Black on white, one page for most tickets. */
export function PrintTicket({ order: o, shop, cfg, employees, onClose }) {
  const c = shop.customers[o.customerId];
  const v = shop.vehicles[o.vehicleId];
  const t = orderTotals(o, cfg, c);
  const lines = (o.lines || []).filter((l) => l.kind !== "note" || l.description);
  const isInvoice = o.status === "invoiced" || o.status === "void";
  const techName = (id) => (employees.find((e) => e.id === id) || {}).name || "";
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const groups = [];
  for (const l of lines) {
    const g = groups[groups.length - 1];
    if (g && g.job === (l.job || "")) g.lines.push(l);
    else groups.push({ job: l.job || "", lines: [l] });
  }
  const recs = o.checklist && o.checklist.items ? recommendedServices(o.checklist.items, cfg.checklist) : [];

  return (
    <div className="printSheet show">
      <div className="printBar">
        <button className="btn ghost" onClick={onClose}>
          Close
        </button>
        <button className="btn primary" onClick={() => window.print()}>
          Print
        </button>
      </div>
      <div className="printWrap">
        <div className="sheet">
          <div className="shHead">
            <div className="shBrand">
              <img className="shLogo" src={cfg.logo || defaultLogo} alt="" />
              <div>
                <h1>{cfg.shopName}</h1>
                <div className="shMeta">
                  {[cfg.shopAddress, fmtPhone(cfg.shopPhone), cfg.shopEmail, cfg.ardNumber ? `BAR ARD #${cfg.ardNumber}` : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
            </div>
            <div className="r">
              <div className="title">
                {statusLabel(o.status)} #{o.number}
              </div>
              <div className="shMeta">
                {fmtDate(o.invoicedAt || o.createdAt)}
                {o.status === "void" ? " · VOID" : ""}
              </div>
            </div>
          </div>

          <div className="shWho">
            <div>
              <h4>Customer</h4>
              <div>
                <strong>{customerName(c)}</strong>
              </div>
              {c && c.company && c.first ? <div>{c.company}</div> : null}
              {c && c.street ? <div>{c.street}</div> : null}
              {c && (c.city || c.zip) ? <div>{[c.city, c.state].filter(Boolean).join(", ")} {c.zip}</div> : null}
              {c && c.phone ? <div>{fmtPhone(c.phone)}</div> : null}
              {c && c.email ? <div>{c.email}</div> : null}
            </div>
            <div>
              <h4>Vehicle</h4>
              <div>
                <strong>{vehicleName(v)}</strong>
              </div>
              {v && v.engine ? <div>{v.engine}</div> : null}
              {v && v.vin ? <div>VIN {v.vin}</div> : null}
              {v && v.plate ? <div>Plate {v.plate}{v.plateState ? ` (${v.plateState})` : ""}</div> : null}
              {o.mileageIn || o.mileageOut ? (
                <div>
                  Mileage {o.mileageIn ? `in ${Number(o.mileageIn).toLocaleString()}` : ""}
                  {o.mileageOut ? ` · out ${Number(o.mileageOut).toLocaleString()}` : ""}
                </div>
              ) : null}
            </div>
          </div>

          <CrewLine o={o} cfg={cfg} name={techName} />

          {o.concern && (
            <p className="shConcern">
              <strong>Customer states:</strong> {o.concern}
            </p>
          )}
          {o.findings && (
            <p className="shConcern">
              <strong>Inspection findings:</strong> {o.findings}
            </p>
          )}

          <table>
            <thead>
              <tr>
                <th style={{ width: 90 }}>Part # / Type</th>
                <th>Description</th>
                <th className="r">Qty</th>
                <th className="r">Each</th>
                <th className="r">Amount</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, gi) => (
                <GroupRows key={gi} g={g} />
              ))}
            </tbody>
          </table>

          {o.checklist && o.checklist.items && o.checklist.items.length > 0 && (
            <div className="shCheck">
              <h4>Service checklist</h4>
              <div className="grid">
                {checklistSummary(o.checklist.items).map((c, i) => (
                  <div key={i}>
                    <span>
                      {i + 1}. {c.label}
                    </span>
                    <strong>{c.text}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}

          {recs.length > 0 && (
            <div className="shCheck shRecs">
              <h4>Recommended services</h4>
              <div className="grid">
                {recs.map((r, i) => (
                  <div key={i}>
                    <span>{r.label}</span>
                    <strong>{r.price > 0 ? `est. ${fmtMoney(r.price)}` : "ask us"}</strong>
                  </div>
                ))}
              </div>
              <p className="shRecNote">Recommended from today's inspection — estimated prices, not included in the total above. Ask us to add any of these.</p>
            </div>
          )}

          <div className="shTotals">
            <div>
              <span>Subtotal</span>
              <span>{fmtMoney(t.subtotal)}</span>
            </div>
            <div>
              <span>Sales tax{t.taxRate ? ` (${t.taxRate}%)` : ""}</span>
              <span>{fmtMoney(t.tax)}</span>
            </div>
            {(o.lines || []).some((l) => l.packaged && l.kind === "part") && (
              <div style={{ fontSize: 9.5, color: "#666", justifyContent: "flex-start" }}>Tax includes the taxable oil and filter in the oil-change package.</div>
            )}
            <div className="grand">
              <span>Total</span>
              <span>{fmtMoney(t.total)}</span>
            </div>
            {(o.payments || []).map((p) => (
              <div key={p.id}>
                <span>
                  Paid {p.method}
                  {p.ref ? ` ${p.ref}` : ""} {fmtDate(p.at)}
                </span>
                <span>-{fmtMoney(p.amount)}</span>
              </div>
            ))}
            {owesBalance(o, t) && (
              <div className="grand">
                <span>Balance due</span>
                <span>{fmtMoney(t.balance)}</span>
              </div>
            )}
          </div>

          {isInvoice ? (
            <>
              {cfg.invoiceFooter && <AuthNote text={cfg.invoiceFooter} fill={o.authFill} />}
              <SignBlock sig={(o.signatures || {}).delivery} label="Customer signature — I have received the vehicle and the work listed above, and a copy of the warranty" />
            </>
          ) : (
            <>
              {cfg.authorizationText && <AuthNote text={cfg.authorizationText} fill={o.authFill} />}
              <SignBlock sig={(o.signatures || {}).authorization} label="Customer signature" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* The authorization/warranty text, with any checkbox and fill-in fields
   the customer answered shown filled in. */
function AuthNote({ text, fill }) {
  const checks = (fill && fill.checks) || {};
  const blanks = (fill && fill.blanks) || {};
  return (
    <p className="shNote" style={{ whiteSpace: "pre-wrap" }}>
      {parseAuthText(text).map((tk, idx) =>
        tk.type === "text" ? (
          tk.text
        ) : tk.type === "check" ? (
          <span key={idx} style={{ fontWeight: 700 }}>{checks[tk.i] ? "[X]" : "[  ]"}</span>
        ) : blanks[tk.i] ? (
          <span key={idx} style={{ fontWeight: 700, textDecoration: "underline" }}> {blanks[tk.i]} </span>
        ) : (
          "____"
        )
      )}
    </p>
  );
}

/* The signature line, with the captured e-signature drawn on it when the
   customer has signed. */
function SignBlock({ sig, label }) {
  if (sig && sig.img)
    return (
      <div className="shSign signed">
        <div>
          <img className="shSigImg" src={sig.img} alt="" />
          <div>
            {label} {sig.name ? `— ${sig.name}` : ""}
          </div>
        </div>
        <div>
          {fmtDate(sig.at)}
          <div>Date</div>
        </div>
      </div>
    );
  return (
    <div className="shSign">
      <div>{label}</div>
      <div>Date</div>
    </div>
  );
}

/* The three people who ran the ticket, named per the shop's setting: the
   advisor on the computer, the top tech over the hood, the pit tech under
   the car. Falls back to the older writer/tech fields on old tickets. */
function CrewLine({ o, cfg, name }) {
  const mode = cfg.printStaffNames || "full";
  if (mode === "off") return null;
  const roles = [
    ["Advisor", o.advisorId || o.writerId],
    ["Top tech", o.topTechId || o.techId],
    ["Pit tech", o.pitTechId],
  ].filter(([, id]) => id && name(id));
  if (!roles.length) return null;
  return (
    <div className="shCrew">
      <span className="shCrewLabel">Serviced by</span>
      {roles.map(([label, id]) => (
        <span key={label}>
          <strong>{label}:</strong> {staffLabel(name(id), mode)}
        </span>
      ))}
    </div>
  );
}

function LineRow({ l }) {
  return (
    <tr>
      <td>{l.kind === "part" ? l.number || "Part" : l.kind === "labor" ? "Labor" : l.kind[0].toUpperCase() + l.kind.slice(1)}</td>
      <td>
        {l.description}
        {l.kind === "part" ? <span style={{ color: "#555" }}> ({conditionLabel(l.condition)})</span> : null}
        {l.kind === "labor" && l.details ? <div style={{ color: "#444", fontSize: 11, marginTop: 2, whiteSpace: "pre-wrap" }}>{l.details}</div> : null}
      </td>
      <td className="r">{l.kind === "labor" ? laborQtyText(l) : l.kind === "note" ? "" : l.qty}</td>
      <td className="r">{l.kind === "labor" ? fmtMoney(l.rate) : l.kind === "note" ? "" : fmtMoney(l.price)}</td>
      <td className="r">{l.kind === "note" ? "" : l.kind === "discount" ? `-${fmtMoney(lineAmount(l))}` : fmtMoney(lineAmount(l))}</td>
    </tr>
  );
}

/* A package (an oil change) prints its service line at the package price,
   then each included part itemized at $0 (it's covered by the package
   price). The parts still carry their taxable value in the totals. Extra
   quarts and a canister-filter charge print as their own priced lines. */
function GroupRows({ g }) {
  const packaged = g.lines.filter((l) => l.packaged);
  const rest0 = g.lines.filter((l) => !l.packaged);
  const pkgAmt = packaged.reduce((a, l) => a + lineAmount(l), 0);
  const details = (packaged.find((l) => l.details) || {}).details;
  const parts = packaged.filter((l) => l.kind === "part");
  /* a filter surcharge is shown on the filter's own line, not as a
     separate charge line */
  const pkgPartIds = new Set(parts.filter((l) => l.partId).map((l) => l.partId));
  const surBy = {};
  for (const l of rest0) if (l.surchargeKind === "filter" && l.surchargeForId && pkgPartIds.has(l.surchargeForId)) surBy[l.surchargeForId] = l;
  const rest = rest0.filter((l) => !(l.surchargeKind === "filter" && l.surchargeForId && pkgPartIds.has(l.surchargeForId)));
  return (
    <>
      {packaged.length > 0 ? (
        <>
          <tr>
            <td>Service</td>
            <td>
              {g.job}
              {details ? <div style={{ color: "#444", fontSize: 11, marginTop: 2, whiteSpace: "pre-wrap" }}>{details}</div> : null}
            </td>
            <td className="r">1</td>
            <td className="r">{fmtMoney(pkgAmt)}</td>
            <td className="r">{fmtMoney(pkgAmt)}</td>
          </tr>
          {parts.map((l) => {
            const sur = l.partId ? surBy[l.partId] : null;
            const amt = sur ? lineAmount(sur) : 0;
            return (
              <tr key={l.id}>
                <td>{l.number || "Part"}</td>
                <td>
                  {l.description}
                  <span style={{ color: "#555" }}> ({conditionLabel(l.condition)})</span>
                  <span style={{ color: "#777" }}> · {sur ? "Filter not standard, additional charge applied" : "included in package"}</span>
                </td>
                <td className="r">{l.qty}</td>
                <td className="r">{fmtMoney(amt)}</td>
                <td className="r">{fmtMoney(amt)}</td>
              </tr>
            );
          })}
        </>
      ) : (
        g.job && (
          <tr className="job">
            <td colSpan={5}>{g.job}</td>
          </tr>
        )
      )}
      {rest.map((l) => (
        <LineRow key={l.id} l={l} />
      ))}
    </>
  );
}
