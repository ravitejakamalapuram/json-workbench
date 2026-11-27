// Renders a component the way a page does: inside a store with a working doc
// engine and a fixed viewport height. happy-dom reports clientHeight 0, so
// without the height VirtualList would mount no rows.
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { ViewportHeightContext } from "../app/ui/VirtualList";
import type { DocFormat, DocumentModel, Surface } from "../platform/types";
import { AppStoreProvider, createAppStore, type AppStore } from "../store";
import type { OpenIndex } from "../store/document";
import { openInFakeWorker } from "./fixtures";

export type TestStoreOptions = {
  readonly surface?: Surface;
  /** The real engine over fake workers by default; pass fakeOpenIndex().openIndex to settle opens by hand. */
  readonly openIndex?: OpenIndex;
};

export function createTestStore({
  surface = "panel",
  openIndex = openInFakeWorker,
}: TestStoreOptions = {}): AppStore {
  return createAppStore({ surface, openIndex });
}

/**
 * Opens `text` as a pasted document and resolves with it once indexing has
 * settled (ready, invalid or failed), which is the DocumentModel a view gets.
 */
export function openText(
  store: AppStore,
  text: string,
  { name = "test.json", format }: { name?: string; format?: DocFormat } = {},
): Promise<DocumentModel> {
  const id = store.getState().openDocument({
    name,
    origin: "paste",
    source: new Blob([text], { type: "application/json" }),
    ...(format && { format }),
  });
  return new Promise((resolve) => {
    const settled = () => {
      const doc = store.getState().docs.find((d) => d.id === id);
      const kind = doc?.status.kind;
      if (doc && kind !== "loading" && kind !== "indexing") {
        unsubscribe();
        resolve(doc);
      }
    };
    const unsubscribe = store.subscribe(settled);
    settled();
  });
}

export type RenderOptions = {
  /** A store from createTestStore(), for a test that opens documents before rendering. */
  readonly store?: AppStore;
  /** Pixels; 560 is 20 rows of 28 px. */
  readonly viewportHeight?: number;
};

export function renderWithStore(
  ui: ReactElement,
  { store = createTestStore(), viewportHeight = 560 }: RenderOptions = {},
): RenderResult & { readonly store: AppStore } {
  const result = render(
    <AppStoreProvider value={store}>
      <ViewportHeightContext.Provider value={viewportHeight}>
        {ui}
      </ViewportHeightContext.Provider>
    </AppStoreProvider>,
  );
  return { ...result, store };
}
