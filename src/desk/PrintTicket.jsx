import { useEffect } from "react";
import { fmtMoney, lineAmount, orderTotals, statusLabel } from "../lib/invoice.js";
import { customerName, vehicleName } from "./useShop.js";
import { fmtDate, fmtPhone } from "./ui.jsx";
import defaultLogo from "../assets/genie-logo.png";

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
            <div>
              <img className="shLogo" src={cfg.logo || defaultLogo} alt="" />
              <h1>{cfg.shopName}</h1>
              <div>{cfg.shopAddress}</div>
              <div>{[fmtPhone(cfg.shopPhone), cfg.shopEmail].filter(Boolean).join(" · ")}</div>
            </div>
            <div className="r">
              <div className="title">
                {statusLabel(o.status)} #{o.number}
              </div>
              <div>{fmtDate(o.invoicedAt || o.createdAt)}</div>
              {o.status === "void" && <div style={{ color: "#b00", fontWeight: 700 }}>VOID</div>}
              {o.writerId && <div>Written by {techName(o.writerId)}</div>}
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
            {(o.payments || []).length > 0 && (
              <div className="grand">
                <span>Balance due</span>
                <span>{fmtMoney(t.balance)}</span>
              </div>
            )}
          </div>

          {isInvoice ? (
            cfg.invoiceFooter && <p className="shNote">{cfg.invoiceFooter}</p>
          ) : (
            <>
              {cfg.authorizationText && <p className="shNote">{cfg.authorizationText}</p>}
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

function GroupRows({ g }) {
  return (
    <>
      {g.job && (
        <tr className="job">
          <td colSpan={5}>{g.job}</td>
        </tr>
      )}
      {g.lines.map((l) => (
        <tr key={l.id}>
          <td>{l.kind === "part" ? l.number || "Part" : l.kind === "labor" ? "Labor" : l.kind[0].toUpperCase() + l.kind.slice(1)}</td>
          <td>{l.description}</td>
          <td className="r">{l.kind === "labor" ? `${l.hours} hr` : l.kind === "note" ? "" : l.qty}</td>
          <td className="r">{l.kind === "labor" ? fmtMoney(l.rate) : l.kind === "note" ? "" : fmtMoney(l.price)}</td>
          <td className="r">{l.kind === "note" ? "" : l.kind === "discount" ? `-${fmtMoney(lineAmount(l))}` : fmtMoney(lineAmount(l))}</td>
        </tr>
      ))}
    </>
  );
}
