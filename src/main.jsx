import { createRoot } from "react-dom/client";
import "./base.css";
import App from "./App.jsx";
import { registerSW } from "./registerSW.js";

const boot = document.getElementById("boot");
if (boot) boot.remove();
createRoot(document.getElementById("root")).render(<App />);
registerSW();
