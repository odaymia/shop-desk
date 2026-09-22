import { useMemo, useState } from "react";
import { Modal } from "./ui.jsx";
import { composeFinding, fixLaborDescription, findingsForCategories, oxfordJoin, lowerFirst, FIX_ACTIONS, SYSTEM_FOR_CATEGORY } from "../lib/findings.js";
import { concernCategories } from "../lib/repairs.js";

/* The fix builder. After inspecting the car, the tech fills in what was
   inspected (tied to the customer's concern), what was found, and the
   recommended fix — it composes a clear, printable finding and a labor line
   the writer puts parts and a labor time against. */
export function FixBuilder({ cfg, concern, onSave, onClose }) {
  const concernLines = useMemo(() => String(concern || "").split("\n").map((l) => l.trim()).filter(Boolean), [concern]);
  const [picked, setPicked] = useState(() => new Set()); // pick the concern(s) this specific fix addresses
  const [inspected, setInspected] = useState("");
  const [foundPicked, setFoundPicked] = useState(() => new Set());
  const [otherFound, setOtherFound] = useState("");
  const [action, setAction] = useState("Replace");
  const [component, setComponent] = useState("");
  const [hours, setHours] = useState("");
  const [addLabor, setAddLabor] = useState(true);

  const selectedConcerns = concernLines.filter((l) => picked.has(l.toLowerCase()));
  const concernText = oxfordJoin(selectedConcerns.map((c) => lowerFirst(c.replace(/[.;\s]+$/, ""))));
  const cats = useMemo(() => concernCategories(selectedConcerns.join("\n"), cfg), [concernText, cfg]); // eslint-disable-line react-hooks/exhaustive-deps
  const systems = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const c of cats) {
      const s = SYSTEM_FOR_CATEGORY[c];
      if (s && !seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    }
    return out;
  }, [cats]);
  const findingGroups = useMemo(() => findingsForCategories(cats, cfg), [cats, cfg]);

  /* selected findings in the taxonomy's order, plus any "other" text */
  const foundList = useMemo(() => {
    const inOrder = findingGroups.flatMap(([, items]) => items).filter((i) => foundPicked.has(i.toLowerCase()));
    const other = otherFound.trim();
    return other ? [...inOrder, other] : inOrder;
  }, [findingGroups, foundPicked, otherFound]);
  const found = oxfordJoin(foundList);

  const finding = composeFinding({ inspected, concern: concernText, found, action, component });
  const laborDesc = fixLaborDescription({ action, component });

  const toggleFound = (item) =>
    setFoundPicked((prev) => {
      const next = new Set(prev);
      const k = item.toLowerCase();
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const toggleConcern = (line) =>
    setPicked((prev) => {
      const next = new Set(prev);
      const k = line.toLowerCase();
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const save = () => {
    onSave({ finding, labor: addLabor ? { description: laborDesc, hours: hours === "" ? "" : Number(hours) } : null });
    onClose();
  };

  return (
    <Modal title="Fix builder — inspection findings" onClose={onClose} size="wide">
      <p className="muted" style={{ marginTop: 0 }}>
        Document what you inspected and found, tied to the customer's concern. It prints on the estimate, and drops in a labor line to
        put parts and time against.
      </p>
      <div className="concernBody">
        <div className="concernGroups fixFields">
          <label className="fixLbl">Addressing which concern?</label>
          {concernLines.length === 0 ? (
            <p className="muted" style={{ margin: "2px 0 0" }}>No customer concern on the ticket yet — build it with the Symptom builder first.</p>
          ) : (
            <div className="symChips">
              {concernLines.map((line) => {
                const on = picked.has(line.toLowerCase());
                return (
                  <button key={line} type="button" className={`symChip ${on ? "on" : ""}`} onClick={() => toggleConcern(line)}>
                    {on ? "✓ " : ""}
                    {line}
                  </button>
                );
              })}
            </div>
          )}

          <label className="fixLbl">Inspected</label>
          {systems.length > 0 && (
            <div className="symChips" style={{ marginBottom: 6 }}>
              {systems.map((s) => (
                <button key={s} type="button" className="symChip" onClick={() => setInspected(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
          <input className="in" value={inspected} onChange={(e) => setInspected(e.target.value)} placeholder="e.g. the front brakes" />

          <label className="fixLbl">Found</label>
          {findingGroups.map(([cat, items]) => (
            <div key={cat} className="findGroup">
              <div className="findCat">{cat}</div>
              <div className="symChips">
                {items.map((item) => {
                  const on = foundPicked.has(item.toLowerCase());
                  return (
                    <button key={item} type="button" className={`symChip findChip ${on ? "on" : ""}`} onClick={() => toggleFound(item)}>
                      {on ? "✓ " : ""}
                      {item}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <input
            className="in"
            style={{ marginTop: 8 }}
            value={otherFound}
            onChange={(e) => setOtherFound(e.target.value)}
            placeholder="Other — type anything not on the list…"
          />

          <label className="fixLbl">Recommend</label>
          <div className="symChips" style={{ marginBottom: 6 }}>
            {FIX_ACTIONS.map(([a]) => (
              <button key={a} type="button" className={`symChip ${action === a ? "on" : ""}`} onClick={() => setAction(a)}>
                {a}
              </button>
            ))}
          </div>
          <input className="in" value={component} onChange={(e) => setComponent(e.target.value)} placeholder="what needs the work, e.g. front brake pads and rotors" />

          <label className="fixLbl">Labor time (hours)</label>
          <input className="in" style={{ maxWidth: 160 }} inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="—" />
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>MOTOR labor times will fill this in automatically once licensing is set up.</p>
          <label className="fld inline" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={addLabor} onChange={(e) => setAddLabor(e.target.checked)} />
            <span>Add a labor line for this fix</span>
          </label>
        </div>

        <div className="concernPreview">
          <div className="symCat">Prints on the ticket</div>
          {finding ? <p className="fixFinding">{finding}</p> : <p className="muted" style={{ margin: 0 }}>Fill in the fields.</p>}
          {addLabor && (
            <>
              <div className="symCat" style={{ marginTop: 12 }}>Labor line</div>
              <div className="concernList">
                <div className="fixLine">
                  <span>{laborDesc || "—"}</span>
                  <b>{hours === "" ? "— hr" : `${hours} hr`}</b>
                </div>
              </div>
            </>
          )}
          <div className="rowBtns" style={{ marginTop: 16 }}>
            <button className="btn primary" onClick={save} disabled={!finding}>
              Add to ticket
            </button>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
