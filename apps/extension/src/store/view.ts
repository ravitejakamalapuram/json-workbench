// Where the user is: the surface the page was opened as, the mode in the rail,
// the view tab, the details panel and the selected node.
import type { SliceCreator, Surface, ViewSlice } from "../platform/types";

const SURFACES: readonly Surface[] = ["panel", "tab", "devtools"];

/** The side panel opens index.html bare; the full tab adds ?surface=tab. */
export function surfaceFromSearch(search: string): Surface {
  const value = new URLSearchParams(search).get("surface");
  return SURFACES.find((surface) => surface === value) ?? "panel";
}

export function createViewSlice(surface: Surface): SliceCreator<ViewSlice> {
  return (set) => ({
    surface,
    mode: "view",
    view: "tree",
    detailsOpen: true,
    paletteOpen: false,
    selection: null,
    setMode: (mode) => set({ mode }),
    setView: (view) => set({ view }),
    setDetailsOpen: (detailsOpen) => set({ detailsOpen }),
    setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    select: (selection) => set({ selection }),
  });
}
