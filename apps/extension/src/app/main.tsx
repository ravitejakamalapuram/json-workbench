// Entry of index.html: the side panel, or the full tab with ?surface=tab.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppStoreProvider, createAppStore } from "../store";
import { loadSettings } from "../store/settings";
import { surfaceFromSearch } from "../store/view";
import { Shell } from "./Shell";

const store = createAppStore({ surface: surfaceFromSearch(location.search) });

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element.");
const page = createRoot(root);

// Rendered once the stored settings are in: nothing can change the theme or
// the recents before then, so the late load cannot overwrite what the user did
// (and the first frame is not drawn in the wrong theme).
void loadSettings(store).then(() =>
  page.render(
    <StrictMode>
      <AppStoreProvider value={store}>
        <Shell />
      </AppStoreProvider>
    </StrictMode>,
  ),
);
