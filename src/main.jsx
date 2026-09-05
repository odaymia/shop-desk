import { createRoot } from "react-dom/client";
import "./base.css";
import App from "./App.jsx";

const boot = document.getElementById("boot");
if (boot) boot.remove();
createRoot(document.getElementById("root")).render(<App />);
