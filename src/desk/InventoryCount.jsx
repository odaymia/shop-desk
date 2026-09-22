import { useState, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Money, fmtDate, toNum, ConfirmModal } from "./ui.jsx";
import { countCategories, countItems, countVariance, applyCounts } from "../lib/inventoryCount.js";
import defaultLogo from "../assets/genie-logo.png";

/* Physical inventory: take a count and enter it.

   Pick a category, then either print a blind count sheet to write on, or count
   right on the tablet. Keying is fast — type the amount, press Enter, the next
   line focuses. When you're done, a variance report shows what's off with the
   total units and dollars, and one button reconciles the on-hand numbers.

   The in-progress count is kept on THIS device (localStorage) so a refresh or a
   long count doesn't lose the work; the permanent change happens only when you
   apply. */
const DRAFT_KEY = "sd:invCount";
const lsGet = (k) => {
  try {
    return JSON.parse(localStorage.getItem(k) || "null");
  } catch {
    return null;
  }
};
const lsSet = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch { /* private mode / quota */ }
};
const lsDel = (k) => {
  try {
    localStorage.removeItem(k);
  } catch { /* ignore */ }
};

/* Print sheets must be a direct child of .root for the print stylesheet to
   reveal them (see the "@media print" rules), so portal them out of the desk. */
const printPortal = (node) => createPortal(node, document.querySelector(".root") || document.body);

export function InventoryCount({ shop, cfg, flash, onClose }) {
  const draft = useMemo(() => lsGet(DRAFT_KEY), []);
  const [phase, setPhase] = useState("setup"); // setup | count | variance
  const [category, setCategory] = useState("all");
  // A count is a fixed snapshot of items plus the amounts entered against them.
  const [session, setSession] = useState(null); // { category, startedAt, items }
  const [counts, setCounts] = useState({}); // itemId -> string amount
  const [printing, setPrinting] = useState(null); // null | "sheet" | "variance"
  const [confirmApply, setConfirmApply] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const cats = useMemo(() => countCategories(shop.parts), [shop.parts]);
  const setupItems = useMemo(() => countItems(shop.parts, category), [shop.parts, category]);

  // keep the draft in sync while counting
  useEffect(() => {
    if (phase === "count" && session) lsSet(DRAFT_KEY, { category: session.category, startedAt: session.startedAt, items: session.items, counts });
  }, [phase, session, counts]);

  const startCount = (cat) => {
    const items = countItems(shop.parts, cat);
    const s = { category: cat, startedAt: Date.now(), items };
    setSession(s);
    setCounts({});
    setPhase("count");
  };
  const resume = () => {
    setSession({ category: draft.category, startedAt: draft.startedAt, items: draft.items });
    setCounts(draft.counts || {});
    setPhase("count");
  };
  const discard = () => {
    lsDel(DRAFT_KEY);
    setSession(null);
    setCounts({});
    setConfirmDiscard(false);
    setPhase("setup");
  };

  const variance = useMemo(() => (session ? countVariance(session.items, counts) : null), [session, counts]);

  const apply = async () => {
    const updates = applyCounts(shop.parts, session.items, counts);
    if (updates.length) await shop.savePartsBulk(updates);
    lsDel(DRAFT_KEY);
    setConfirmApply(false);
    flash(`Inventory updated — ${updates.length} item${updates.length === 1 ? "" : "s"} counted`);
    onClose();
  };

  const catLabel = session ? (session.category === "all" ? "All items" : session.category) : "";

  // ---- print overlays ----
  // Mounted at the .root level: the print stylesheet only reveals a .printSheet
  // that's a direct child of .root (it hides .root's other children), so a sheet
  // nested inside the desk would print blank.
  if (printing === "sheet") return printPortal(<CountSheet cfg={cfg} category={catLabel} items={session.items} onClose={() => setPrinting(null)} />);
  if (printing === "variance") return printPortal(<VarianceSheet cfg={cfg} category={catLabel} variance={variance} onClose={() => setPrinting(null)} />);

  // ---- setup: pick a category ----
  if (phase === "setup") {
    return (
      <>
        <header className="deskHead">
          <button className="btn ghost" onClick={onClose}>← Inventory</button>
          <h1>Take inventory</h1>
        </header>
        <div className="deskBody">
          {draft && draft.items && (
            <div className="resumeBar">
              <div>
                <strong>Count in progress</strong>
                <span className="muted"> — {draft.category === "all" ? "All items" : draft.category}, started {fmtDate(draft.startedAt)}. {Object.values(draft.counts || {}).filter((v) => v !== "" && v != null).length} entered.</span>
              </div>
              <div className="grow" />
              <button className="btn" onClick={() => setConfirmDiscard(true)}>Discard</button>
              <button className="btn primary" onClick={resume}>Resume count</button>
            </div>
          )}
          <p className="muted" style={{ maxWidth: 620 }}>
            Pick what to count. Print a sheet to write the amounts on, or count right here on the tablet — either way you'll
            key the numbers in and get a report of what's off.
          </p>
          <div className="catBar" style={{ margin: "10px 0 18px" }}>
            <button className={`btn tiny ${category === "all" ? "primary" : ""}`} onClick={() => setCategory("all")}>All items</button>
            {cats.map((c) => (
              <button key={c} className={`btn tiny ${category === c ? "primary" : ""}`} onClick={() => setCategory(c)}>{c}</button>
            ))}
          </div>
          <div className="countStart">
            <div className="muted">{setupItems.length} item{setupItems.length === 1 ? "" : "s"} in {category === "all" ? "inventory" : category}</div>
            <div className="rowBtns" style={{ marginTop: 14 }}>
              <button className="btn primary lg" disabled={!setupItems.length} onClick={() => startCount(category)}>Count on tablet</button>
              <button className="btn lg" disabled={!setupItems.length} onClick={() => { startCount(category); setTimeout(() => setPrinting("sheet"), 0); }}>Print count sheet</button>
            </div>
          </div>
        </div>
        {confirmDiscard && (
          <ConfirmModal title="Discard the count in progress?" confirmText="Discard" onConfirm={discard} onClose={() => setConfirmDiscard(false)}>
            The amounts entered so far will be cleared. Inventory isn't changed.
          </ConfirmModal>
        )}
      </>
    );
  }

  // ---- variance review ----
  if (phase === "variance") {
    return (
      <>
        <header className="deskHead">
          <button className="btn ghost" onClick={() => setPhase("count")}>← Keep counting</button>
          <h1>What's off — {catLabel}</h1>
          <div className="grow" />
          <button className="btn" onClick={() => setPrinting("variance")}>Print</button>
          <button className="btn primary" disabled={!variance.countedItems} onClick={() => setConfirmApply(true)}>Apply counts</button>
        </header>
        <div className="deskBody">
          <VarianceTotals v={variance} />
          <div className="tableCard scroll" style={{ marginTop: 16 }}>
            <table className="dk">
              <thead>
                <tr>
                  <th>Part #</th>
                  <th>Description</th>
                  <th className="r">Expected</th>
                  <th className="r">Counted</th>
                  <th className="r">Off</th>
                  <th className="r">$ Off</th>
                </tr>
              </thead>
              <tbody>
                {variance.lines.length === 0 && (
                  <tr><td colSpan={6} className="emptyNote">Everything counted matches the computer. Nothing off.</td></tr>
                )}
                {variance.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="num"><strong>{l.number || "—"}</strong></td>
                    <td>{l.description}</td>
                    <td className="r num muted">{l.expected}</td>
                    <td className="r num">{l.counted}</td>
                    <td className={`r num ${l.diff < 0 ? "vShort" : "vOver"}`}>{l.diff > 0 ? `+${l.diff}` : l.diff}</td>
                    <td className={`r num ${l.diffValue < 0 ? "vShort" : "vOver"}`}>{l.diffValue > 0 ? "+" : ""}<Money v={l.diffValue} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {confirmApply && (
          <ConfirmModal
            title={`Apply ${variance.countedItems} counted item${variance.countedItems === 1 ? "" : "s"}?`}
            confirmText="Apply counts"
            onConfirm={apply}
            onClose={() => setConfirmApply(false)}
          >
            On-hand will be set to what you counted. {variance.offCount} item{variance.offCount === 1 ? " is" : "s are"} off, a
            net of {variance.netValue < 0 ? "−" : ""}{money(Math.abs(variance.netValue))}. This can't be undone.
          </ConfirmModal>
        )}
      </>
    );
  }

  // ---- counting (tablet entry / keying from the sheet) ----
  return (
    <CountEntry
      items={session.items}
      counts={counts}
      setCounts={setCounts}
      catLabel={catLabel}
      onSheet={() => setPrinting("sheet")}
      onReview={() => setPhase("variance")}
      onSaveClose={onClose}
      onBack={() => setPhase("setup")}
    />
  );
}

/* The fast entry grid: type an amount, Enter jumps to the next line. Blind —
   the expected number isn't shown, so the count stays honest. */
function CountEntry({ items, counts, setCounts, catLabel, onSheet, onReview, onSaveClose, onBack }) {
  const refs = useRef([]);
  const entered = items.filter((it) => counts[it.id] !== undefined && counts[it.id] !== "").length;

  const set = (id, v) => setCounts((c) => ({ ...c, [id]: v.replace(/[^0-9.]/g, "") }));
  const onKey = (e, i) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const next = refs.current[i + 1];
      if (next) next.focus();
      else onReview();
    }
  };

  return (
    <>
      <header className="deskHead">
        <button className="btn ghost" onClick={onBack}>← Categories</button>
        <h1>Count — {catLabel}</h1>
        <div className="grow" />
        <span className="muted">{entered} of {items.length} entered</span>
        <button className="btn" onClick={onSheet}>Print sheet</button>
        <button className="btn" onClick={onSaveClose}>Save &amp; close</button>
        <button className="btn primary" onClick={onReview}>Review what's off</button>
      </header>
      <div className="deskBody">
        <p className="muted" style={{ marginTop: 0 }}>Type the amount you counted and press <kbd>Enter</kbd> to drop to the next line. Skip anything you didn't count — it won't change.</p>
        <div className="tableCard scroll">
          <table className="dk countGrid">
            <thead>
              <tr>
                <th>Part #</th>
                <th>Description</th>
                <th>Bin</th>
                <th className="r">Counted</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const has = counts[it.id] !== undefined && counts[it.id] !== "";
                return (
                  <tr key={it.id} className={has ? "counted" : ""}>
                    <td className="num"><strong>{it.number || "—"}</strong></td>
                    <td>{it.description}</td>
                    <td className="muted">{it.location}</td>
                    <td className="r">
                      <input
                        ref={(el) => (refs.current[i] = el)}
                        className="countInput"
                        inputMode="decimal"
                        value={counts[it.id] ?? ""}
                        onChange={(e) => set(it.id, e.target.value)}
                        onKeyDown={(e) => onKey(e, i)}
                        onFocus={(e) => e.target.select()}
                        aria-label={`Counted ${it.description}`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function VarianceTotals({ v }) {
  return (
    <div className="vTotals">
      <div>
        <span>Items off</span>
        <b>{v.offCount}</b>
      </div>
      <div>
        <span>Units off (net)</span>
        <b>{v.netUnits > 0 ? `+${v.netUnits}` : v.netUnits}</b>
      </div>
      <div>
        <span>Short</span>
        <b className="vShort">{v.shortValue ? "−" : ""}<Money v={v.shortValue} /></b>
      </div>
      <div>
        <span>Over</span>
        <b className="vOver">{v.overValue ? "+" : ""}<Money v={v.overValue} /></b>
      </div>
      <div>
        <span>Net off</span>
        <b className={v.netValue < 0 ? "vShort" : "vOver"}>{v.netValue < 0 ? "−" : v.netValue > 0 ? "+" : ""}<Money v={Math.abs(v.netValue)} /></b>
      </div>
    </div>
  );
}

/* Blind count sheet to print and write on — no expected amounts. */
function CountSheet({ cfg, category, items, onClose }) {
  return (
    <div className="printSheet show">
      <div className="printBar">
        <button className="btn ghost" onClick={onClose}>Close</button>
        <button className="btn primary" onClick={() => window.print()}>Print</button>
      </div>
      <div className="printWrap">
        <div className="sheet">
          <PrintHead cfg={cfg} title="Physical count sheet" category={category} />
          <div className="countByLine">Counted by ____________________&nbsp;&nbsp;&nbsp;Date __________</div>
          <table className="countPrint">
            <thead>
              <tr>
                <th>Part #</th>
                <th>Description</th>
                <th>Bin</th>
                <th className="cnt">Counted</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td className="num">{it.number}</td>
                  <td>{it.description}</td>
                  <td>{it.location}</td>
                  <td className="cnt"></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* Printable variance report — what was off, with totals at the bottom. */
function VarianceSheet({ cfg, category, variance, onClose }) {
  return (
    <div className="printSheet show">
      <div className="printBar">
        <button className="btn ghost" onClick={onClose}>Close</button>
        <button className="btn primary" onClick={() => window.print()}>Print</button>
      </div>
      <div className="printWrap">
        <div className="sheet">
          <PrintHead cfg={cfg} title="Inventory variance" category={category} />
          <table className="countPrint">
            <thead>
              <tr>
                <th>Part #</th>
                <th>Description</th>
                <th className="cnt">Expected</th>
                <th className="cnt">Counted</th>
                <th className="cnt">Off</th>
                <th className="cnt">$ Off</th>
              </tr>
            </thead>
            <tbody>
              {variance.lines.map((l) => (
                <tr key={l.id}>
                  <td className="num">{l.number}</td>
                  <td>{l.description}</td>
                  <td className="cnt">{l.expected}</td>
                  <td className="cnt">{l.counted}</td>
                  <td className="cnt">{l.diff > 0 ? `+${l.diff}` : l.diff}</td>
                  <td className="cnt">{money(l.diffValue)}</td>
                </tr>
              ))}
              {variance.lines.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", padding: 20 }}>Nothing off.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>{variance.offCount} item{variance.offCount === 1 ? "" : "s"} off · {variance.absUnits} unit{variance.absUnits === 1 ? "" : "s"}</td>
                <td className="cnt">{variance.netUnits > 0 ? `+${variance.netUnits}` : variance.netUnits}</td>
                <td className="cnt">{money(variance.netValue)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

function PrintHead({ cfg, title, category }) {
  return (
    <div className="shHead">
      <div className="shBrand">
        <img className="shLogo" src={cfg.logo || defaultLogo} alt="" />
        <div>
          <h1>{cfg.shopName}</h1>
          <div className="shMeta">{title} · {category} · {fmtDate(Date.now())}</div>
        </div>
      </div>
    </div>
  );
}

const money = (n) => `${n < 0 ? "−" : ""}$${Math.abs(toNum(n)).toFixed(2)}`;
