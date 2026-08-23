import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

window.addEventListener("contextmenu", (e) => {
  const el = e.target as HTMLElement | null;
  if (el && el.closest("input, textarea, [contenteditable='true']")) return;
  e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
