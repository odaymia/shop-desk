import { useState } from "react";
import { Modal, Field, Text } from "./ui.jsx";
import { uid } from "../lib/ids.js";

/* The staff list is shared with the time clock (same storage key), so a
   tech entered here shows up on the clock and vice versa. Only names and
   jobs are handled here. PINs and pay rates belong to the clock and are
   carried through untouched. */
export function Staff({ roster, saveRoster, flash }) {
  const [edit, setEdit] = useState(null);
  const rows = [...roster].sort((a, b) => (a.active === false) - (b.active === false) || a.name.localeCompare(b.name));
  return (
    <>
      <header className="deskHead">
        <h1>Staff</h1>
        <div className="grow" />
        <button className="btn primary" onClick={() => setEdit({ name: "", role: "", active: true })}>
          Add someone
        </button>
      </header>
      <div className="deskBody">
        <div className="tableCard">
          <table className="dk">
            <thead>
              <tr>
                <th>Name</th>
                <th>Job</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="emptyNote">
                    Nobody yet. Add your service writers and techs so they can be put on tickets.
                  </td>
                </tr>
              )}
              {rows.map((e) => (
                <tr key={e.id} className={e.active === false ? "off" : ""}>
                  <td>
                    <strong>{e.name}</strong>
                  </td>
                  <td className="muted">{e.role || "Technician"}</td>
                  <td className="r">
                    <span className="rowActs">
                      <button className="btn tiny" onClick={() => setEdit({ ...e })}>
                        Edit
                      </button>
                      <button
                        className="btn tiny"
                        onClick={async () => {
                          await saveRoster(roster.map((x) => (x.id === e.id ? { ...x, active: x.active === false } : x)));
                        }}
                      >
                        {e.active === false ? "Bring back" : "Set inactive"}
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="legalNote">
          Shared with the time clock. Give new people their punch-in PIN on the clock's Roster screen; hourly rates
          live there too and are never shown here.
        </p>
      </div>
      {edit && (
        <Modal title={edit.id ? "Edit person" : "Add someone"} onClose={() => setEdit(null)}>
          <Field label="Name">
            <Text value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} autoFocus placeholder="First and last" />
          </Field>
          <Field label="Job">
            <Text value={edit.role} onChange={(v) => setEdit({ ...edit, role: v })} placeholder="Service writer, lube tech, brake tech…" />
          </Field>
          <button
            className="btn primary lg full"
            onClick={async () => {
              if (!edit.name.trim()) return flash("Name can't be blank", "out");
              const rec = { ...edit, name: edit.name.trim() };
              const next = rec.id ? roster.map((x) => (x.id === rec.id ? { ...x, ...rec } : x)) : [...roster, { ...rec, id: uid(), pin: "" }];
              await saveRoster(next);
              setEdit(null);
              flash("Staff saved");
            }}
          >
            Save
          </button>
        </Modal>
      )}
    </>
  );
}
