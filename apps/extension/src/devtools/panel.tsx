// Owned by item "tabimport". F1a stub of the DevTools panel page; the item
// mounts the shell here with its network list as `extraSources`.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Stub } from "../app/ui/Stub";
import "../theme/tokens.css";

const root = document.getElementById("root");
if (!root) throw new Error("devtools-panel.html has no #root element.");
createRoot(root).render(
  <StrictMode>
    <Stub id="tabimport" />
  </StrictMode>,
);
