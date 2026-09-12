import { useEffect } from "react";
import { fmtMoney, laborQtyText, lineAmount, orderTotals, statusLabel, conditionLabel, owesBalance } from "../lib/invoice.js";
import { customerName, vehicleName } from "./useShop.js";
import { fmtDate, fmtPhone } from "./ui.jsx";
import defaultLogo from "../assets/genie-logo.png";
import { staffLabel } from "../lib/names.js";
import { checklistSummary } from "../lib/checklist.js";

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
                {staffLine(o, cfg, techName)}
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

          {o.concern && (
            <p className="shConcern">
              <strong>Customer states:</strong> {o.concern}
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

          <div className="shTotals">
            {t.parts > 0 && (
              <div>
                <span>Parts</span>
                <span>{fmtMoney(t.parts)}</span>
              </div>
            )}
            {t.labor > 0 && (
              <div>
                <span>Labor</span>
                <span>{fmtMoney(t.labor)}</span>
              </div>
            )}
            {t.sublet > 0 && (
              <div>
                <span>Sublet</span>
                <span>{fmtMoney(t.sublet)}</span>
              </div>
            )}
            {t.fees > 0 && (
              <div>
                <span>Fees</span>
                <span>{fmtMoney(t.fees)}</span>
              </div>
            )}
            {t.supplies > 0 && (
              <div>
                <span>Shop supplies</span>
                <span>{fmtMoney(t.supplies)}</span>
              </div>
            )}
            {t.discounts > 0 && (
              <div>
                <span>Discounts</span>
                <span>-{fmtMoney(t.discounts)}</span>
              </div>
            )}
            <div>
              <span>Sales tax{t.taxRate ? ` (${t.taxRate}%)` : ""}</span>
              <span>{fmtMoney(t.tax)}</span>
            </div>
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
              {cfg.invoiceFooter && <p className="shNote" style={{ whiteSpace: "pre-wrap" }}>{cfg.invoiceFooter}</p>}
              <div className="shSign">
                <div>Customer signature — I have received the vehicle and the work listed above, and a copy of the warranty</div>
                <div>Date</div>
              </div>
            </>
          ) : (
            <>
              {cfg.authorizationText && <p className="shNote" style={{ whiteSpace: "pre-wrap" }}>{cfg.authorizationText}</p>}
              <div className="shSign">
                <div>Customer signature</div>
                <div>Date</div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* " · Writer: Sam G. · Tech: M.S." per the shop's setting */
function staffLine(o, cfg, techName) {
  const mode = cfg.printStaffNames || "full";
  if (mode === "off") return "";
  const bits = [];
  const w = o.writerId ? staffLabel(techName(o.writerId), mode) : "";
  const t = o.techId ? staffLabel(techName(o.techId), mode) : "";
  if (w) bits.push(`Writer: ${w}`);
  if (t) bits.push(`Tech: ${t}`);
  return bits.length ? ` · ${bits.join(" · ")}` : "";
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

/* A package (an oil change) folds its service/oil/filter lines into one
   line at the package price. The parts-vs-labor split still shows in the
   totals below. Anything else in the group (extra quarts) prints as its
   own line. */
function GroupRows({ g }) {
  const packaged = g.lines.filter((l) => l.packaged);
  const rest = g.lines.filter((l) => !l.packaged);
  const pkgAmt = packaged.reduce((a, l) => a + lineAmount(l), 0);
  const details = (packaged.find((l) => l.details) || {}).details;
  return (
    <>
      {packaged.length > 0 ? (
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
