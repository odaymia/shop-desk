import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/* base "./" so the built dist/ works from any HTTPS host or subfolder —
   the shop iPad loads it from wherever it happens to be hosted. */
export default defineConfig({
  plugins: [react()],
  base: "./",
});
