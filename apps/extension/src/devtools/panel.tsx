// Placeholder for the DevTools panel page, which is not part of the first
// release. It would mount the shell here with its network list as `extraSources`.
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
