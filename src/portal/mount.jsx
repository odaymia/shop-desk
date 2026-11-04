import { createRoot } from "react-dom/client";
import "../base.css";
import "./portal.css";
import Portal from "./Portal.jsx";

/* Render the customer portal into an element. Used by the portal's own entry
   (portal/index.html on the app host) and by the shop-site bootstrap when a
   shop's own domain serves the portal at /portal/ (src/site/main.js). */
export function mountPortal(el) {
  createRoot(el).render(<Portal />);
}
