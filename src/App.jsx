import { useState, useEffect, useRef, useCallback } from "react";
import { Desk } from "./desk/Desk.jsx";
import { Setup } from "./components/Setup.jsx";
import { Toast } from "./components/Toast.jsx";
import { DEFAULT_CFG } from "./lib/config.js";
import { CFG_KEY, ROSTER_KEY } from "./lib/keys.js";
import { cloud, sGet, sSet, storageReady } from "./storage/index.js";

/* Root: loads settings and the shared staff list, then shows the desk.
   No PIN — this runs on the counter PC signed in with the shop account.
   Roles (who can see reports, who can void) are on the roadmap. */
export default function App() {
  const [ready, setReady] = useState(false);
  const [cfg, setCfg] = useState(DEFAULT_CFG);
  const [roster, setRoster] = useState([]);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    (async () => {
      await storageReady();
      const c = await sGet(CFG_KEY, null);
      if (c) setCfg({ ...DEFAULT_CFG, ...c });
      setRoster((await sGet(ROSTER_KEY, [])) || []);
      setReady(true);
    })();
  }, []);

  /* another computer, or the time clock, changed something we hold */
  useEffect(
    () =>
      cloud.subscribe(async (e) => {
        if (e.type !== "data") return;
        const keys = e.keys || [];
        if (keys.includes(CFG_KEY)) {
          const c = await sGet(CFG_KEY, null);
          if (c) setCfg({ ...DEFAULT_CFG, ...c });
        }
        if (keys.includes(ROSTER_KEY)) setRoster((await sGet(ROSTER_KEY, [])) || []);
      }),
    []
  );

  const flash = useCallback((text, tone) => {
    setToast({ text, tone });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const saveCfg = useCallback(async (next) => {
    setCfg(next);
    await sSet(CFG_KEY, next);
  }, []);
  const saveRoster = useCallback(async (next) => {
    setRoster(next);
    await sSet(ROSTER_KEY, next);
  }, []);

  if (!ready)
    return (
      <div className="root">
        <div className="bootWrap">
          <div className="bootPulse" />
          <p className="bootTxt">Opening the front desk…</p>
        </div>
      </div>
    );

  if (!cfg.shopName)
    return (
      <div className="root">
        <Setup cfg={cfg} onDone={saveCfg} />
      </div>
    );

  return (
    <div className="root">
      <Desk cfg={cfg} saveCfg={saveCfg} roster={roster} saveRoster={saveRoster} flash={flash} />
      <Toast text={toast?.text} tone={toast?.tone} />
    </div>
  );
}
