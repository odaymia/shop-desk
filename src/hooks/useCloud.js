import { useState, useEffect } from "react";
import { cloud } from "../storage/index.js";

/* Live view of the cloud sync state for UI. */
export function useCloud() {
  const [s, setS] = useState(cloud.getState());
  useEffect(() => cloud.subscribe((e) => e.type === "state" && setS(cloud.getState())), []);
  return s;
}

/* Bumps whenever a pull changed local data. Put it in an effect's deps to
   re-read a key when another device changed it. */
export function useStorageVersion() {
  const [v, setV] = useState(0);
  useEffect(() => cloud.subscribe((e) => e.type === "data" && setV((x) => x + 1)), []);
  return v;
}
