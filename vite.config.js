import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/* base "./" so the built dist/ works from any HTTPS host or subfolder —
   the shop iPad loads it from wherever it happens to be hosted. */
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        portal: resolve(__dirname, "portal/index.html"),
        sign: resolve(__dirname, "sign/index.html"),
        inspect: resolve(__dirname, "inspect/index.html"),
        site: resolve(__dirname, "site/index.html"),
        unsubscribe: resolve(__dirname, "unsubscribe/index.html"),
      },
      /* the website's script keeps a fixed address (site/app.js) so a page on
         a shop's own domain can load it and pull its latest content */
      output: { entryFileNames: (c) => (c.name === "site" ? "site/app.js" : "assets/[name]-[hash].js") },
    },
  },
});
