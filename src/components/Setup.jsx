import { useState } from "react";
import { CloudSync } from "./CloudSync.jsx";
import { useCloud } from "../hooks/useCloud.js";
import defaultLogo from "../assets/genie-logo.png";

/* First run. Name the shop, or sign in and let the settings come across. */
export function Setup({ cfg, onDone }) {
  const [name, setName] = useState(cfg.shopName || "");
  const [err, setErr] = useState("");
  const [signin, setSignin] = useState(false);
  const cloudState = useCloud();
  const go = () => {
    if (!name.trim()) return setErr("Give the shop a name.");
    onDone({ ...cfg, shopName: name.trim() });
  };
  return (
    <div className="setupWrap">
      <div className="setupCard">
        <img className="setupLogo" src={defaultLogo} alt="" />
        <h1 className="setupTitle">Set up the front desk</h1>
        <p className="setupLead">
          Tickets, customers, inventory, and invoices for the shop. Runs in the browser on the counter PC, keeps
          working with no internet, and syncs when it's back.
        </p>
        <label className="fld">
          <span>Shop name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Shop name" autoFocus />
        </label>
        {err && <p className="fldErr">{err}</p>}
        <button className="btn primary lg full" onClick={go}>
          Open the desk
        </button>
        {cloudState.configured && (
          <div className="setupCloud">
            {signin ? (
              <>
                <p className="setupNote">
                  Sign in with the account the time clock uses. The staff list comes across right away, and
                  anything already entered on another computer follows.
                </p>
                <CloudSync compact />
              </>
            ) : (
              <button className="linkBtn wide" onClick={() => setSignin(true)}>
                Already using the time clock or another desk? Sign in instead
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
