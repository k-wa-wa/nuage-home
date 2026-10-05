import ReactDOM from "react-dom/client";
import { CameraTestApp } from "./CameraTestApp.tsx";
import "../ui/theme.css";
import "./camera.css";

const rootEl = document.getElementById("root");
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(<CameraTestApp />);
}
