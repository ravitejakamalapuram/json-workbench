// The one store (TARGET.md section 3.2): flat slices in a single Zustand store.
// Each page creates its own and provides it, so a test renders against a fresh
// store with fake engines and nothing leaks between tests.
import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { AppState, Surface } from "../platform/types";
import { createCompareSlice } from "./compare";
import { createDocumentSlice, type OpenIndex } from "./document";
import { createSettingsSlice } from "./settings";
import { createTransformSlice } from "./transform";
import { createViewSlice } from "./view";

export type AppStore = StoreApi<AppState>;

export type AppStoreOptions = {
  readonly surface: Surface;
  /** The doc engine; tests pass fakeOpenIndex from testing/fixtures.ts. */
  readonly openIndex?: OpenIndex;
};

// Placeholder until the doc engine of F1a step 4 is merged: the merge makes
// `openDocument` from platform/doc/open.ts the default and deletes this.
const engineNotBuilt: OpenIndex = () => {
  throw new Error("Opening documents is not available in this build yet.");
};

export function createAppStore({
  surface,
  openIndex = engineNotBuilt,
}: AppStoreOptions): AppStore {
  return createStore<AppState>()((...args) => ({
    ...createDocumentSlice({ openIndex })(...args),
    ...createViewSlice(surface)(...args),
    ...createSettingsSlice()(...args),
    // These two spawn their own workers when they first need them.
    ...createCompareSlice()(...args),
    ...createTransformSlice()(...args),
  }));
}

const AppStoreContext = createContext<AppStore | null>(null);

/** Page entries (app/main.tsx, devtools/panel.tsx) wrap the shell in this. */
export const AppStoreProvider = AppStoreContext.Provider;

/** The store itself, for reading a snapshot in an event handler (ActionContext.state). */
export function useAppStoreApi(): AppStore {
  const store = useContext(AppStoreContext);
  if (!store)
    throw new Error("useAppStore needs an AppStoreProvider above it.");
  return store;
}

/** Subscribes to the part of the state `selector` returns. */
export function useAppStore<T>(selector: (state: AppState) => T): T {
  return useStore(useAppStoreApi(), selector);
}
