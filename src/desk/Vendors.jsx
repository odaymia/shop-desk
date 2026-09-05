import { useState } from "react";
import { Modal, Field, Text, fmtPhone } from "./ui.jsx";
import { activeList } from "./useShop.js";

const blank = () => ({ name: "", phone: "", email: "", account: "", website: "", notes: "", active: true });

export function Vendors({ shop, flash }) {
  const [edit, setEdit] = useState(null);
  const rows = activeList(shop.vendors).sort((a, b) => a.name.localeCompare(b.name));
  const partCount = (id) => activeList(shop.parts).filter((p) => p.vendorId === id).length;
  return (
    <>
      <header className="deskHead">
        <h1>Vendors</h1>
        <div className="grow" />
        <button className="btn primary" onClick={() => setEdit(blank())}>
          Add vendor
        </button>
      </header>
      <div className="deskBody">
        <div className="tableCard">
          <table className="dk">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Phone</th>
                <th>Account #</th>
                <th>Email</th>
                <th className="r">Parts</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="emptyNote">
                    No vendors yet. Add the parts stores you buy from: O'Reilly, WorldPac, your tire distributor.
                  </td>
                </tr>
              )}
              {rows.map((v) => (
                <tr key={v.id} className="row" onClick={() => setEdit({ ...blank(), ...v })}>
                  <td>
                    <strong>{v.name}</strong>
                    {v.notes ? <span className="sub">{v.notes}</span> : null}
                  </td>
                  <td className="num">{fmtPhone(v.phone)}</td>
                  <td className="num muted">{v.account}</td>
                  <td className="muted">{v.email}</td>
                  <td className="r num">{partCount(v.id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {edit && (
        <Modal title={edit.id ? "Edit vendor" : "Add vendor"} onClose={() => setEdit(null)}>
          <Field label="Name">
            <Text value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} autoFocus />
          </Field>
          <div className="fldRow">
            <Field label="Phone">
              <Text value={edit.phone} onChange={(v) => setEdit({ ...edit, phone: v })} inputMode="tel" />
            </Field>
            <Field label="Account #">
              <Text value={edit.account} onChange={(v) => setEdit({ ...edit, account: v })} />
            </Field>
          </div>
          <Field label="Email">
            <Text value={edit.email} onChange={(v) => setEdit({ ...edit, email: v })} type="email" />
          </Field>
          <Field label="Notes (delivery times, rep name)">
            <textarea className="ta" value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
          </Field>
          {edit.id && (
            <label className="fld inline">
              <input type="checkbox" checked={edit.active === false} onChange={(e) => setEdit({ ...edit, active: !e.target.checked })} />
              <span>No longer use this vendor</span>
            </label>
          )}
          <button
            className="btn primary lg full"
            onClick={async () => {
              if (!edit.name.trim()) return flash("Vendor needs a name", "out");
              await shop.saveVendor({ ...edit, name: edit.name.trim() });
              setEdit(null);
              flash("Vendor saved");
            }}
          >
            Save vendor
          </button>
        </Modal>
      )}
    </>
  );
}
