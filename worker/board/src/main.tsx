import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { captureAttribution } from "./attribution";
import "./index.css";

// 新用户从哪来：先记下来源，再把地址栏改干净
captureAttribution();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
