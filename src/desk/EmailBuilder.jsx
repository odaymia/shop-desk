import { useState } from "react";
import { cloud } from "../storage/index.js";
import { Field, Text } from "./ui.jsx";
import { BLOCK_TYPES, blockLabel, newBlock, EMAIL_PHOTOS, emailPhotoUrl, specBlocks, DEFAULT_THEME } from "../lib/emailBlocks.js";
import { couponText } from "../lib/website.js";

/* The email builder: the email's blocks, in order, each opened to edit,
   moved up or down, or removed, plus the design (header, corners). Used by
   campaigns and by each automatic email. `value` is the email spec
   ({ subject, preheader, theme, blocks }); older specs become blocks. */

/* Shrink an uploaded photo for email: 1200px wide JPEG */
function shrink(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1200 / img.width);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't read that photo"))), "image/jpeg", 0.82);
    };
    img.onerror = () => rej(new Error("That file isn't a photo the browser can read."));
    img.src = url;
  });
}

function PhotoPick({ value, onChange, flash }) {
  const [busy, setBusy] = useState(false);
  const own = /^https:\/\//.test(value || "");
  return (
    <div className="fld">
      <span>Photo</span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {EMAIL_PHOTOS.map((p) => (
          <button
            key={p.id}
            type="button"
            title={p.label}
            onClick={() => onChange(p.id)}
            style={{ padding: 0, border: value === p.id ? "3px solid var(--accent, #d9a400)" : "3px solid transparent", borderRadius: 7, background: "none", cursor: "pointer" }}
          >
            <img src={emailPhotoUrl(p.id, 120, 72)} alt={p.label} style={{ width: 72, height: 44, objectFit: "cover", borderRadius: 4, display: "block" }} />
          </button>
        ))}
        {own && <img src={value} alt="Your photo" style={{ width: 72, height: 44, objectFit: "cover", borderRadius: 6, border: "3px solid var(--accent, #d9a400)" }} />}
        <label className="btn tiny">
          {busy ? "Uploading…" : "Upload"}
          <input
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            disabled={busy}
            onChange={async (e) => {
              const f = e.target.files && e.target.files[0];
              e.target.value = "";
              if (!f) return;
              setBusy(true);
              try {
                onChange(await cloud.uploadPublicImage(await shrink(f), "email"));
              } catch (err) {
                flash && flash(err.message, "out");
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        {value && (
          <button type="button" className="btn tiny" onClick={() => onChange("")}>
            No photo
          </button>
        )}
      </div>
    </div>
  );
}

function LinkPick({ link, url, onChange, allowNone = true }) {
  return (
    <div className="fldRow">
      <Field label="Links to">
        <select value={link || ""} onChange={(e) => onChange({ link: e.target.value })}>
          <option value="site">Our website</option>
          <option value="offer">The coupon's page</option>
          <option value="review">Our Google reviews</option>
          <option value="custom">A link I choose</option>
          {allowNone && <option value="">Nothing</option>}
        </select>
      </Field>
      {link === "custom" && (
        <Field label="Link">
          <Text value={url || ""} onChange={(v) => onChange({ url: v })} placeholder="https://…" />
        </Field>
      )}
    </div>
  );
}

function BlockFields({ b, set, shop, services, flash, placeholderHint }) {
  switch (b.type) {
    case "hero":
      return (
        <>
          <PhotoPick value={b.photo} onChange={(v) => set({ photo: v })} flash={flash} />
          <Field label="Headline">
            <Text value={b.headline} onChange={(v) => set({ headline: v })} maxLength={80} />
          </Field>
          <Field label={`Text${placeholderHint}`}>
            <textarea rows={3} value={b.text} onChange={(e) => set({ text: e.target.value })} />
          </Field>
          <Field label="Button text (blank for no button)">
            <Text value={b.buttonLabel} onChange={(v) => set({ buttonLabel: v })} maxLength={40} />
          </Field>
          <LinkPick link={b.link} url={b.url} onChange={set} />
        </>
      );
    case "text":
      return (
        <>
          <Field label="Heading (optional)">
            <Text value={b.title} onChange={(v) => set({ title: v })} maxLength={80} />
          </Field>
          <Field label={`Text (a blank line starts a new paragraph${placeholderHint ? `;${placeholderHint.slice(2)}` : ""})`}>
            <textarea rows={6} value={b.text} onChange={(e) => set({ text: e.target.value })} />
          </Field>
        </>
      );
    case "coupon":
      return (
        <>
          <Field label="Coupon">
            <select value={b.couponId || ""} onChange={(e) => set({ couponId: e.target.value })}>
              <option value="">Pick a coupon</option>
              {Object.values(shop.coupons || {})
                .filter((c) => c && c.active !== false && !c.deleted)
                .sort((x, y) => String(x.code).localeCompare(String(y.code)))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name || couponText(c)}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Small print">
            <Text value={b.note} onChange={(v) => set({ note: v })} maxLength={80} />
          </Field>
        </>
      );
    case "services":
      return (
        <>
          <Field label="Heading">
            <Text value={b.title} onChange={(v) => set({ title: v })} maxLength={60} />
          </Field>
          <div className="fld">
            <span>Services (up to 4; none picked shows the first two)</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
              {services.map((s) => {
                const on = (b.ids || []).includes(s.id);
                return (
                  <label key={s.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="checkbox" checked={on} disabled={!on && (b.ids || []).length >= 4} onChange={() => set({ ids: on ? b.ids.filter((x) => x !== s.id) : [...(b.ids || []), s.id] })} />
                    {s.name}
                  </label>
                );
              })}
            </div>
          </div>
        </>
      );
    case "split":
      return (
        <>
          <PhotoPick value={b.photo} onChange={(v) => set({ photo: v })} flash={flash} />
          <Field label="Heading">
            <Text value={b.title} onChange={(v) => set({ title: v })} maxLength={80} />
          </Field>
          <Field label="Text">
            <textarea rows={3} value={b.text} onChange={(e) => set({ text: e.target.value })} />
          </Field>
          <Field label="Button text (blank for no button)">
            <Text value={b.buttonLabel} onChange={(v) => set({ buttonLabel: v })} maxLength={40} />
          </Field>
          <LinkPick link={b.link} url={b.url} onChange={set} />
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={!!b.flip} onChange={(e) => set({ flip: e.target.checked })} /> Photo on the right
          </label>
        </>
      );
    case "image":
      return (
        <>
          <PhotoPick value={b.photo} onChange={(v) => set({ photo: v })} flash={flash} />
          <Field label="Caption (optional)">
            <Text value={b.caption} onChange={(v) => set({ caption: v })} maxLength={120} />
          </Field>
          <LinkPick link={b.link} url={b.url} onChange={set} />
        </>
      );
    case "review":
      return (
        <>
          <Field label="What the customer said (use a real review)">
            <textarea rows={3} value={b.quote} onChange={(e) => set({ quote: e.target.value })} maxLength={300} />
          </Field>
          <div className="fldRow">
            <Field label="Who said it">
              <Text value={b.name} onChange={(v) => set({ name: v })} placeholder="Maria G., Google review" maxLength={60} />
            </Field>
            <Field label="Stars">
              <select value={b.stars || 5} onChange={(e) => set({ stars: Number(e.target.value) })}>
                {[5, 4, 3].map((n) => (
                  <option key={n} value={n}>
                    {"★".repeat(n)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </>
      );
    case "button":
      return (
        <>
          <Field label="Button text">
            <Text value={b.label} onChange={(v) => set({ label: v })} maxLength={40} />
          </Field>
          <LinkPick link={b.link} url={b.url} onChange={set} allowNone={false} />
        </>
      );
    case "visit":
      return (
        <Field label="Heading (your address, hours, and phone fill in from Settings)">
          <Text value={b.title} onChange={(v) => set({ title: v })} maxLength={60} />
        </Field>
      );
    default:
      return <p className="muted" style={{ margin: 0 }}>A line between sections.</p>;
  }
}

/* a one-line summary on a closed block, so the list reads like the email */
function summary(b, shop) {
  switch (b.type) {
    case "hero":
    case "split":
      return b.headline || b.title || "";
    case "text":
      return b.title || String(b.text || "").split("\n").find((l) => l.trim()) || "";
    case "coupon": {
      const c = shop.coupons && shop.coupons[b.couponId];
      return c ? `${c.code} — ${c.name || couponText(c)}` : "No coupon picked yet";
    }
    case "services":
      return `${(b.ids || []).length || "First 2"} service${(b.ids || []).length === 1 ? "" : "s"}`;
    case "review":
      return b.quote ? `“${b.quote}”` : "No quote yet";
    case "button":
      return b.label || "";
    case "visit":
      return "Address, hours, directions";
    default:
      return "";
  }
}

export function EmailBuilder({ value, onChange, shop, services, flash, showSubject = true, placeholders = "{first_name}", brandColor = "" }) {
  const blocks = specBlocks(value);
  const theme = { ...DEFAULT_THEME, ...(value.theme || {}) };
  const [open, setOpen] = useState(blocks[0] ? blocks[0].id : null);
  const [adding, setAdding] = useState("");
  const setBlocks = (next) => onChange({ ...value, blocks: next });
  const setBlock = (id, patch) => setBlocks(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const move = (i, d) => {
    const n = [...blocks];
    const j = i + d;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]];
    setBlocks(n);
  };
  const hint = placeholders ? ` (${placeholders} fill in per person)` : "";

  return (
    <div>
      {showSubject && (
        <>
          <Field label={`Subject line${hint}`}>
            <Text value={value.subject || ""} onChange={(v) => onChange({ ...value, subject: v })} maxLength={120} placeholder="{first_name}, $20 off your next oil change" />
          </Field>
          <Field label="Preview text (the gray line after the subject in the inbox)">
            <Text value={value.preheader || ""} onChange={(v) => onChange({ ...value, preheader: v })} maxLength={140} />
          </Field>
        </>
      )}
      <div className="fldRow">
        <Field label="Header">
          <select value={theme.header} onChange={(e) => onChange({ ...value, theme: { ...theme, header: e.target.value } })}>
            <option value="dark">Dark, with a brand-color line</option>
            <option value="brand">Brand color</option>
            <option value="light">White</option>
          </select>
        </Field>
        <Field label="Corners">
          <select value={theme.corners} onChange={(e) => onChange({ ...value, theme: { ...theme, corners: e.target.value } })}>
            <option value="rounded">Rounded</option>
            <option value="square">Square</option>
          </select>
        </Field>
        <Field label="Accent color">
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="color" value={theme.color || brandColor || "#8e2f2f"} onChange={(e) => onChange({ ...value, theme: { ...theme, color: e.target.value } })} style={{ width: 48, height: 38, padding: 2, flexShrink: 0 }} />
            {theme.color && (
              <button type="button" className="btn ghost sm" onClick={() => onChange({ ...value, theme: { ...theme, color: "" } })}>
                Reset
              </button>
            )}
          </span>
        </Field>
      </div>

      <div className="fld" style={{ marginTop: 6 }}>
        <span>The email, top to bottom</span>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {blocks.map((b, i) => (
          <div key={b.id} style={{ border: `1px solid ${open === b.id ? "var(--accent, #d9a400)" : "var(--line)"}`, borderRadius: 10, background: "var(--panel, #fff)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", cursor: "pointer" }} onClick={() => setOpen(open === b.id ? null : b.id)}>
              <b style={{ minWidth: 118 }}>{blockLabel(b.type)}</b>
              <span className="muted" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14 }}>
                {summary(b, shop)}
              </span>
              <button type="button" className="btn tiny" title="Move up" disabled={i === 0} onClick={(e) => (e.stopPropagation(), move(i, -1))}>
                ↑
              </button>
              <button type="button" className="btn tiny" title="Move down" disabled={i === blocks.length - 1} onClick={(e) => (e.stopPropagation(), move(i, 1))}>
                ↓
              </button>
              <button type="button" className="btn tiny" title="Remove" onClick={(e) => (e.stopPropagation(), setBlocks(blocks.filter((x) => x.id !== b.id)))}>
                ✕
              </button>
            </div>
            {open === b.id && (
              <div style={{ padding: "4px 12px 12px", borderTop: "1px solid var(--line)" }}>
                <BlockFields b={b} set={(patch) => setBlock(b.id, patch)} shop={shop} services={services} flash={flash} placeholderHint={hint} />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="rowBtns" style={{ marginTop: 10, alignItems: "center" }}>
        <select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Block to add">
          <option value="">Add a block…</option>
          {BLOCK_TYPES.map(([t, label, note]) => (
            <option key={t} value={t}>
              {label} — {note}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          disabled={!adding}
          onClick={() => {
            const nb = newBlock(adding);
            setBlocks([...blocks, nb]);
            setOpen(nb.id);
            setAdding("");
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

/* the preview frame: desktop or phone width */
export function EmailPreview({ html, subject }) {
  const [phone, setPhone] = useState(false);
  return (
    <div>
      <div className="rowBtns" style={{ alignItems: "center", marginBottom: 6 }}>
        <div className="seg">
          <button type="button" className={!phone ? "on" : ""} onClick={() => setPhone(false)}>
            Desktop
          </button>
          <button type="button" className={phone ? "on" : ""} onClick={() => setPhone(true)}>
            Phone
          </button>
        </div>
      </div>
      {subject && (
        <p className="muted" style={{ margin: "0 0 6px" }}>
          <b>Subject:</b> {subject}
        </p>
      )}
      <div style={{ display: "flex", justifyContent: "center", background: "#eef0f3", border: "1px solid var(--line)", borderRadius: 10 }}>
        <iframe title="Email preview" srcDoc={html} sandbox="" style={{ width: phone ? 375 : "100%", height: 760, border: 0, background: "#eef0f3" }} />
      </div>
    </div>
  );
}
