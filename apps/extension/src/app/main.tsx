// Entry of index.html: the side panel, or the full tab with ?surface=tab.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppStoreProvider, createAppStore } from "../store";
import { loadSettings } from "../store/settings";
import { surfaceFromSearch } from "../store/view";
import { Shell } from "./Shell";

const store = createAppStore({ surface: surfaceFromSearch(location.search) });
void loadSettings(store);

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element.");
createRoot(root).render(
  <StrictMode>
    <AppStoreProvider value={store}>
      <Shell />
    </AppStoreProvider>
  </StrictMode>,
);
