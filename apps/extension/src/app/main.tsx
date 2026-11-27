// Placeholder entry until the minimal shell lands (F1a step 3). It mounts the
// shell stub and every registry entry, so the build and a real extension load
// exercise every stub from the first commit.
import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import type { DocumentModel } from "../platform/types";
import "../theme/tokens.css";
import { registry } from "./registry";
import { Shell } from "./Shell";

const placeholder: DocumentModel = {
  id: "placeholder",
  name: "placeholder.json",
  origin: "sample",
  format: "json",
  bytes: 2,
  source: new Blob(["{}"]),
  status: { kind: "loading" },
  markers: {},
  edited: false,
};

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element.");
createRoot(root).render(
  <StrictMode>
    <Shell />
    <Suspense fallback={null}>
      {registry.modes.map(({ id, Component }) => (
        <Component key={id} />
      ))}
      {[...registry.views, ...registry.details].map(({ id, Component }) => (
        <Component key={id} doc={placeholder} />
      ))}
    </Suspense>
  </StrictMode>,
);
