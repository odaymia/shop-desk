/* Read at build time from .env (Vite). Empty strings mean "no cloud";
   the app then runs exactly as before, local-only. */
const env = (typeof import.meta !== "undefined" && import.meta.env) || {};
export const SUPABASE_URL = env.VITE_SUPABASE_URL || "";
export const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY || "";
