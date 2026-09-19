import { useEffect, useRef, useState } from "react";
import { searchAddresses } from "../lib/addressLookup.js";

/* A street-address input that suggests full addresses as you type (free OSM
   lookup) and, on pick, fills street / city / state / ZIP. `onChange` gets the
   raw text for free typing; `onPick` gets { street, city, state, zip } when a
   suggestion is chosen. Falls back to a plain input if the lookup is down. */
export function AddressField({ value, onChange, onPick, near, placeholder, autoFocus, inputProps }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const box = useRef(null);
  const abort = useRef(null);
  const skipNext = useRef(false); // don't re-search the text we just filled in

  useEffect(() => {
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    const q = String(value || "").trim();
    if (q.length < 3) {
      setItems([]);
      setOpen(false);
      return;
    }
    const t = setTimeout(async () => {
      if (abort.current) abort.current.abort();
      const ac = new AbortController();
      abort.current = ac;
      setLoading(true);
      try {
        const res = await searchAddresses(q, { signal: ac.signal, near });
        setItems(res);
        setActive(-1);
        setOpen(res.length > 0);
      } catch (e) {
        if (e.name !== "AbortError") {
          setItems([]);
          setOpen(false);
        }
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [value, near]);

  useEffect(() => {
    const onDoc = (e) => {
      if (box.current && !box.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const choose = (a) => {
    skipNext.current = true;
    onPick(a);
    setOpen(false);
    setItems([]);
    setActive(-1);
  };

  const onKey = (e) => {
    if (!open || !items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      choose(items[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="addrAc" ref={box}>
      <input
        value={value == null ? "" : value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        onFocus={() => items.length && setOpen(true)}
        placeholder={placeholder || "Start typing the address…"}
        autoFocus={autoFocus}
        autoComplete="off"
        {...inputProps}
      />
      {open && items.length > 0 && (
        <ul className="addrList" role="listbox">
          {items.map((a, i) => (
            <li
              key={a.label + i}
              role="option"
              aria-selected={i === active}
              className={i === active ? "on" : ""}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(a);
              }}
            >
              {a.label}
            </li>
          ))}
        </ul>
      )}
      {loading && open && items.length === 0 && <div className="addrHint">Looking up addresses…</div>}
    </div>
  );
}
