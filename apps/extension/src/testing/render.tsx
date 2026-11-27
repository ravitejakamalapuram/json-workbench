// Renders a component the way a page does: inside a fresh store, with a fake
// doc engine and a fixed viewport height. happy-dom reports clientHeight 0,
// so without the height VirtualList would mount no rows.
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { ViewportHeightContext } from "../app/ui/VirtualList";
import type { Surface } from "../platform/types";
import { AppStoreProvider, createAppStore, type AppStore } from "../store";
import {
  fakeIndex,
  fakeOpenIndex,
  type FakeIndex,
  type PendingOpen,
} from "./fixtures";

export type RenderOptions = {
  readonly surface?: Surface;
  /** Pixels; 560 is 20 rows of 28 px. */
  readonly viewportHeight?: number;
  /** The index each opened document gets; an empty one by default. */
  readonly makeIndex?: () => FakeIndex;
};

export type RenderedApp = RenderResult & {
  readonly store: AppStore;
  /** Every document the store asked the engine to open, settled by the test. */
  readonly opens: PendingOpen[];
};

export function renderWithStore(
  ui: ReactElement,
  {
    surface = "panel",
    viewportHeight = 560,
    makeIndex = fakeIndex,
  }: RenderOptions = {},
): RenderedApp {
  const { openIndex, opens } = fakeOpenIndex(makeIndex);
  const store = createAppStore({ surface, openIndex });
  const result = render(
    <AppStoreProvider value={store}>
      <ViewportHeightContext.Provider value={viewportHeight}>
        {ui}
      </ViewportHeightContext.Provider>
    </AppStoreProvider>,
  );
  return { ...result, store, opens };
}
