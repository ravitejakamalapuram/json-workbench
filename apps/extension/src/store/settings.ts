// Preferences and recents. Every value persists in chrome.storage.local through
// platform/storage.ts; recents hold names, sizes and times, never content.
import type { StoreApi } from "zustand/vanilla";
import { clearStored, readStored, writeStored } from "../platform/storage";
import {
  LIMITS,
  MATERIALIZE_LIMITS_MB,
  type AppState,
  type MaterializeLimitMb,
  type RecentFile,
  type SettingsSlice,
  type SliceCreator,
  type Theme,
} from "../platform/types";

type Settings = Pick<SettingsSlice, "theme" | "materializeLimitMb" | "recents">;

const DEFAULTS: Settings = {
  theme: "light",
  materializeLimitMb: 64,
  recents: [],
};

export function createSettingsSlice(): SliceCreator<SettingsSlice> {
  return (set, get) => ({
    ...DEFAULTS,
    setTheme: (theme) => {
      set({ theme });
      void writeStored("jwb.theme", theme);
    },
    setMaterializeLimitMb: (materializeLimitMb) => {
      set({ materializeLimitMb });
      void writeStored("jwb.materializeLimitMb", materializeLimitMb);
    },
    addRecent: (file) => {
      const recents = [
        file,
        ...get().recents.filter((recent) => recent.name !== file.name),
      ].slice(0, LIMITS.recents);
      set({ recents });
      void writeStored("jwb.recents", recents);
    },
    clearRecents: () => {
      set({ recents: [] });
      void writeStored("jwb.recents", []);
    },
    clearLocalData: async () => {
      // Reset the live slices too: a slice that still held its old value
      // would write it straight back on the next save.
      set(DEFAULTS);
      get().resetTransform();
      await clearStored();
    },
  });
}

const isTheme = (value: unknown): value is Theme =>
  value === "light" || value === "dark";

const isLimit = (value: unknown): value is MaterializeLimitMb =>
  MATERIALIZE_LIMITS_MB.some((limit) => limit === value);

function isRecent(value: unknown): value is RecentFile {
  const file = value as Partial<Record<keyof RecentFile, unknown>> | null;
  return (
    typeof file?.name === "string" &&
    typeof file.bytes === "number" &&
    typeof file.openedAt === "number"
  );
}

/** Restores the stored settings at boot, skipping values an older version wrote in another shape. */
export async function loadSettings(store: StoreApi<AppState>): Promise<void> {
  const [theme, limit, recents]: unknown[] = await Promise.all([
    readStored("jwb.theme"),
    readStored("jwb.materializeLimitMb"),
    readStored("jwb.recents"),
  ]);
  store.setState({
    ...(isTheme(theme) && { theme }),
    ...(isLimit(limit) && { materializeLimitMb: limit }),
    ...(Array.isArray(recents) && {
      recents: recents.filter(isRecent).slice(0, LIMITS.recents),
    }),
  });
}
