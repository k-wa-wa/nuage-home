import ReactDOM from "react-dom/client";
import { VoiceApp } from "./VoiceApp.tsx";
import "./ui/theme.css";
import "./ui/report.css";
import "./style.css";

const rootEl = document.getElementById("app");
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(<VoiceApp />);
}
