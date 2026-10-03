import ReactDOM from "react-dom/client";
import { SandboxApp } from "../SandboxApp.tsx";
import "../ui/theme.css";
import "../ui/report.css";
import "./sandbox.css";

const rootEl = document.getElementById("sandbox");
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(<SandboxApp />);
}
