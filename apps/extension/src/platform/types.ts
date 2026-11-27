// The contracts every part of the extension builds against (TARGET.md section 3).
// Frozen at the end of F1a: an owner may add optional fields to its own slice,
// never rename or remove. Types that cross a worker boundary are `type` aliases,
// not interfaces, so they satisfy `Plain` in platform/workers/protocol.ts.
import type { PipelineDefinition } from "@json-workbench/core";
import type { ComponentType, ReactNode } from "react";
import type { StateCreator } from "zustand";
import type { CompareSlice } from "../store/compare";
import type { TransformSlice } from "../store/transform";

const MiB = 1024 * 1024;

/** Every size bound in one place. "Chars" are UTF-16 code units; "Bytes" are UTF-8 bytes. */
export const LIMITS = {
  /** Largest text the main thread holds and Raw edits; above it Raw is a read-only pager and the doc worker uses the byte-range index. */
  rawEditChars: 2 * MiB,
  /** One window of the Raw pager. */
  rawPageBytes: 1 * MiB,
  /** In-page "Open in Workbench" handoff through storage.session (10 MiB quota, measured in the first build). */
  handoffBytes: 8 * MiB,
  /** "Import active tab" text in the sendMessage reply (64 MiB ceiling, measured in the first build). */
  activeTabBytes: 32 * MiB,
  /** A string expanded as embedded JSON; the main thread holds it while the worker indexes it. */
  embeddedChars: 1 * MiB,
  /** A pasted Compare side; larger inputs load from an open document instead. */
  compareTextChars: 2 * MiB,
  /** YAML input; the yaml package parsed 5.6 MB in 7.6 s in the review sandbox. */
  yamlMaxBytes: 8 * MiB,
  /** Rows "Expand all" may open in the tree. */
  expandAllRows: 10_000,
  /** Schema and insight markers Raw draws at once. */
  maxMarkersDrawn: 500,
  /** Search stops after this many hits and says "1,000+". */
  searchHits: 1_000,
  /** NodeInfo.text and Cell.text are cut here, long enough for a typical JWT. */
  previewChars: 1_024,
  /** One page of children() or records(). */
  pageSize: 200,
  /** Records sampled for table columns, generated types and JSONL schema validation. */
  sampleRecords: 1_000,
  /** Recent files kept in settings. */
  recents: 10,
} as const;

/** Heap is about 6x the source bytes when a value is materialized, so these bound whole-value work. */
export const MATERIALIZE_LIMITS_MB = [32, 64, 128] as const;
export type MaterializeLimitMb = (typeof MATERIALIZE_LIMITS_MB)[number];

/** Thrown (and sent across workers by name) when an input passes one of the limits above. */
export class TooLargeError extends Error {
  readonly name = "TooLargeError";
}

// ---------------------------------------------------------------- documents

/** RFC 6901 JSON Pointer; "" is the root. JSONL records are "/0", "/1", ... of a virtual root array. */
export type Pointer = string;
export type DocId = string;
/** The format of the input. YAML is converted to JSON text when it is opened. */
export type DocFormat = "json" | "jsonl" | "yaml";
/** The format of the text an index covers. */
export type IndexedFormat = "json" | "jsonl";
export type DocOrigin =
  | "file"
  | "paste"
  | "sample"
  | "handoff"
  | "tab"
  | "devtools"
  | "embedded"
  | "convert"
  | "transform";
export type NodeKind =
  "object" | "array" | "string" | "number" | "boolean" | "null";

export type NodeInfo = {
  readonly pointer: Pointer;
  /** Property name, array index, or null for the root. */
  readonly key: string | number | null;
  readonly kind: NodeKind;
  /** UTF-8 byte offset of the value's first byte in the indexed text. */
  readonly byteStart: number;
  /** Exclusive end; absent while a container is still being scanned. */
  readonly byteEnd?: number;
  /** Containers only; absent until known. */
  readonly childCount?: number;
  /** Primitives only: strings decoded without quotes, numbers in their source digits (never through Number), true, false, null. */
  readonly text?: string;
  /** `text` was cut at LIMITS.previewChars; read the whole value with slice(byteStart, byteEnd). */
  readonly truncated?: true;
};

export type ChildrenPage = {
  readonly items: readonly NodeInfo[];
  /** Children known so far; final when totalFinal is true. The tree shows "N+" until then. */
  readonly total: number;
  readonly totalFinal: boolean;
};

/** One table cell. Containers read "{3}" or "[2]". */
export type Cell = {
  readonly kind: NodeKind;
  readonly text: string;
  readonly truncated?: true;
};
/** An element of the array being tabled. Object records have one cell per property; any other record has one cell under the key "". */
export type RecordRow = {
  readonly pointer: Pointer;
  readonly cells: Readonly<Record<string, Cell>>;
};
export type RecordsPage = {
  readonly rows: readonly RecordRow[];
  readonly total: number;
  readonly totalFinal: boolean;
};

export type SearchQuery = {
  readonly text: string;
  readonly caseSensitive: boolean;
  readonly regex: boolean;
  readonly scope: "all" | "keys" | "values";
};
/** A match as byte offsets in the indexed text; pointerAt(byteStart) resolves it when the user goes to it. */
export type SearchHit = {
  readonly byteStart: number;
  readonly byteEnd: number;
  readonly field: "key" | "value";
};
export type SearchSummary = { readonly hits: number; readonly capped: boolean };
export type ByteRange = {
  readonly byteStart: number;
  readonly byteEnd: number;
};

/**
 * Read access to one document's structure. On the main thread this is a proxy
 * over the doc worker (one worker per document); memory-index.ts serves texts
 * up to LIMITS.rawEditChars, range-index.ts serves larger ones from the Blob.
 * Every method is answerable while the index is still being built.
 */
export interface DocumentIndex {
  node(pointer: Pointer): Promise<NodeInfo | null>;
  children(
    pointer: Pointer,
    offset: number,
    limit: number,
  ): Promise<ChildrenPage>;
  /** The child position at each level from the root down to `pointer` ([] for the root), so a reveal never pages. Null when absent. */
  locate(pointer: Pointer): Promise<readonly number[] | null>;
  /** The deepest node whose value contains the byte offset. An object member's key token counts as part of that member, so a key search hit resolves to the member. */
  pointerAt(byteOffset: number): Promise<Pointer>;
  /** Elements of the array at `pointer` (the virtual root for JSONL) as table rows. */
  records(
    pointer: Pointer,
    offset: number,
    limit: number,
  ): Promise<RecordsPage>;
  /** Runs in a disposable worker; aborting terminates it. Hits arrive in batches and stop at LIMITS.searchHits. */
  search(
    query: SearchQuery,
    onHits: (hits: readonly SearchHit[]) => void,
    signal: AbortSignal,
  ): Promise<SearchSummary>;
  /** Decoded text of a byte range of the indexed text; slice(node.byteStart, node.byteEnd) is the node's source text. */
  slice(byteStart: number, byteEnd: number): Promise<string>;
  /** Byte ranges of values, for drawing markers in Raw; null where a pointer does not exist. */
  offsets(pointers: readonly Pointer[]): Promise<readonly (ByteRange | null)[]>;
  /** The line (from 1, counting "\n") that holds the byte offset; the Raw pager numbers each window from it. */
  lineAt(byteOffset: number): Promise<number>;
  /** Terminates the worker. Closing a document must call it. */
  dispose(): void;
}

/** A syntax error. Line and column count from 1; columns count UTF-16 code units, as CodeMirror does. */
export type ParseIssue = {
  readonly message: string;
  readonly byteOffset: number;
  readonly line: number;
  readonly column: number;
};
export type IndexProgress = {
  readonly indexedBytes: number;
  readonly totalBytes: number;
  readonly records: number;
};
/** `nodes` is null when the range index did not count every node. */
export type IndexSummary = {
  readonly records: number;
  readonly nodes: number | null;
};

export type DocStatus =
  | { readonly kind: "loading" }
  | {
      readonly kind: "indexing";
      readonly index: DocumentIndex;
      readonly progress: IndexProgress;
    }
  | {
      readonly kind: "ready";
      readonly index: DocumentIndex;
      readonly summary: IndexSummary;
    }
  /** No index: Raw reads the window around issues[0] straight from `source`. */
  | { readonly kind: "invalid"; readonly issues: readonly ParseIssue[] }
  | { readonly kind: "failed"; readonly message: string };

/** Producers of row markers; tree and Raw draw them, producers draw nothing. */
export type MarkerSource = "schema" | "insights";
export type Marker = {
  readonly pointer: Pointer;
  readonly severity: "error" | "warning";
  readonly message: string;
};

export interface DocumentModel {
  readonly id: DocId;
  /** A file name, or a hostname for page imports; never a path or a query string. */
  readonly name: string;
  readonly origin: DocOrigin;
  readonly format: DocFormat;
  /** Size of the input as opened, for the status bar. */
  readonly bytes: number;
  /** The JSON or JSONL text the index covers: the input, its JSON conversion once a YAML open settles, or the latest Raw edit. */
  readonly source: Blob;
  readonly status: DocStatus;
  readonly markers: Readonly<Partial<Record<MarkerSource, readonly Marker[]>>>;
  /** Changed in Raw since it was opened. */
  readonly edited: boolean;
}

/** Text from a paste, a page or DevTools is wrapped in a Blob the moment it arrives. */
export type OpenRequest = {
  readonly name: string;
  readonly origin: DocOrigin;
  readonly source: Blob;
  /** Detected by platform/formats.ts when omitted. */
  readonly format?: DocFormat;
};

/** Options for loadValue (platform/doc/load-value.ts), the only way a worker materializes a value. */
export type LoadValueOptions = {
  readonly format: IndexedFormat;
  /** Rejects with TooLargeError above this; callers pass materializeLimitMb in bytes. */
  readonly maxBytes: number;
  /** JSONL: read at most this many records from the start. */
  readonly maxRecords?: number;
};

/** The selected node. With embedded JSON, `via` holds the pointers of the expanded strings, outermost first, and `pointer` is inside the innermost one. */
export type Selection = {
  readonly docId: DocId;
  readonly pointer: Pointer;
  readonly via?: readonly Pointer[];
  /**
   * With `via`: the index of the innermost expanded string, which `pointer`
   * belongs to; readers use it instead of the document's index. The tree sets
   * it, and clears the selection before it disposes that index.
   */
  readonly index?: DocumentIndex;
};

// ------------------------------------------------------------------- store

export type Surface = "panel" | "tab" | "devtools";
export type Theme = "light" | "dark";
export type ModeId = "view" | "compare" | "transform" | "types" | "jwt";
export type ViewId = "tree" | "raw" | "table";
export type RecentFile = {
  readonly name: string;
  readonly bytes: number;
  readonly openedAt: number;
};

export interface DocumentSlice {
  /** Open documents in tab order. */
  docs: readonly DocumentModel[];
  activeDocId: DocId | null;
  /** Adds the document as "loading", makes it active and starts indexing; origin "file" also adds a recent. */
  openDocument(request: OpenRequest): DocId;
  /** Disposes the index first, so its worker ends. */
  closeDocument(id: DocId): void;
  setActiveDocument(id: DocId): void;
  /** Raw only, text up to LIMITS.rawEditChars: replaces `source`, sets `edited` and re-indexes in the worker. */
  editDocument(id: DocId, text: string): void;
  /** Stops indexing; the document becomes failed with "Indexing cancelled." */
  cancelIndexing(id: DocId): void;
  setMarkers(id: DocId, source: MarkerSource, markers: readonly Marker[]): void;
}

export interface ViewSlice {
  /** From ?surface= at boot; never changes. */
  readonly surface: Surface;
  mode: ModeId;
  view: ViewId;
  detailsOpen: boolean;
  paletteOpen: boolean;
  selection: Selection | null;
  setMode(mode: ModeId): void;
  setView(view: ViewId): void;
  /** An explicit value, never a toggle: the narrow-window effect closes details without knowing their state. */
  setDetailsOpen(open: boolean): void;
  setPaletteOpen(open: boolean): void;
  select(selection: Selection | null): void;
}

export interface SettingsSlice {
  theme: Theme;
  materializeLimitMb: MaterializeLimitMb;
  /** Newest first, at most LIMITS.recents; names and sizes only, never content. */
  recents: readonly RecentFile[];
  setTheme(theme: Theme): void;
  setMaterializeLimitMb(limit: MaterializeLimitMb): void;
  addRecent(file: RecentFile): void;
  clearRecents(): void;
  /** Clears chrome.storage.local and resets every live slice that persists (settings, recents, the transform pipeline), so nothing old is written back. */
  clearLocalData(): Promise<void>;
}

/** Slices are flat in one store, so each slice's keys are unique; compare and transform prefix theirs. */
export type AppState = DocumentSlice &
  ViewSlice &
  SettingsSlice &
  CompareSlice &
  TransformSlice;

/** Slice creators take their worker factory, so tests pass the fake worker. */
export type SliceDeps = { readonly spawn: () => Worker };
export type SliceCreator<S> = StateCreator<AppState, [], [], S>;

/**
 * Everything the extension persists, all in chrome.storage.local. This is the
 * PRIVACY.md inventory: a new key needs a line there. Keys start with "jwb."
 * except the review flag, which predates the prefix and keeps its name so a
 * user who saw the nudge never sees it again.
 */
export type StoredValues = {
  "jwb.theme": Theme;
  "jwb.materializeLimitMb": MaterializeLimitMb;
  "jwb.recents": readonly RecentFile[];
  "jwb.pipeline": PipelineDefinition;
  "json-workbench:review-prompt": {
    /** Successful pipeline runs on the user's own data. */
    readonly successfulRuns: number;
    /** A document larger than the threshold parsed without error. */
    readonly largeDocumentParsed: boolean;
    /** The banner has been shown once; never show it again. */
    readonly prompted: boolean;
  };
};

// ---------------------------------------------------------------- registry

export interface ViewProps {
  readonly doc: DocumentModel;
}

export interface ViewPlugin {
  readonly id: ViewId;
  readonly label: string;
  /** true, or the reason the tab is disabled (its title and accessible description). Total: never throws for any status. */
  supports(doc: DocumentModel): true | string;
  /** React.lazy, except tree (the default view ships in the entry chunk). */
  readonly Component: ComponentType<ViewProps>;
  /** View controls on the right of the toolbar row; must fit the 400 px side panel. */
  readonly Toolbar?: ComponentType<ViewProps>;
  /** The 32 px bar under the view and the details panel: the tree's breadcrumbs, Raw's cursor position. */
  readonly StatusBar?: ComponentType<ViewProps>;
  readonly actions?: readonly Action[];
}

/** The rail lists "View" (the shell's document workspace) and then these, in registry order. */
export interface ModePlugin {
  readonly id: Exclude<ModeId, "view">;
  readonly label: string;
  /** true: the shell shows its empty state instead of the mode while no document is open. */
  readonly needsDocument: boolean;
  /** React.lazy. */
  readonly Component: ComponentType;
  readonly actions?: readonly Action[];
}

/**
 * A section of the details panel, stacked under the shell's "Selected" block
 * (path, Copy path, Copy value), which no section repeats. `views` omitted
 * means every view. A section with nothing to say renders null.
 */
export interface DetailsSection {
  readonly id: string;
  /** Sentence case; the panel shows it as a small caps heading. */
  readonly title: string;
  readonly views?: readonly ViewId[];
  readonly Component: ComponentType<ViewProps>;
}

/** Where an action is offered: command palette, toolbar row, details panel, tree row badge. */
export type Placement = "palette" | "toolbar" | "details" | "row";
/** The item that owns an action is the first segment of its id; registry.test.ts checks shortcuts against that item's namespace. */
export type ActionOwner =
  | "app"
  | "shell"
  | "tree"
  | "embedded"
  | "insights"
  | "raw"
  | "table"
  | "compare"
  | "transform"
  | "types"
  | "jwt"
  | "yaml"
  | "schema";

export interface ActionContext {
  /** Store snapshot at invocation; act through its slice methods. */
  readonly state: AppState;
  readonly doc: DocumentModel | undefined;
  /** The row's node for "row"; the selected node for palette and details, when there is one. */
  readonly node: NodeInfo | undefined;
}

export interface Action {
  readonly id: `${ActionOwner}.${string}`;
  /** A sentence-case verb phrase: "Format", "Copy path", "Decode JWT". */
  readonly label: string;
  /** Canonical form: modifiers in the order Mod, Alt, Shift, then the key ("Mod+Shift+F", "Alt+1", "Mod+.", "?"). Mod is Cmd on macOS, Ctrl elsewhere. */
  readonly shortcut?: string;
  readonly placement: readonly Placement[];
  /** The toolbar's one filled button (Export). */
  readonly primary?: true;
  when?(ctx: ActionContext): boolean;
  /** Omitted when a mounted component binds the action with useActionHandler (app/actions.ts); unbound, it is unavailable. */
  run?(ctx: ActionContext): void | Promise<void>;
}

/** app/registry.ts, written once by the foundation: items export plain values and this lists them. */
export interface Registry {
  readonly modes: readonly ModePlugin[];
  readonly views: readonly ViewPlugin[];
  readonly details: readonly DetailsSection[];
  /** Every action, including those carried by modes and views. */
  readonly actions: readonly Action[];
}

export interface ShellProps {
  /** Extra ways to open a document in the empty state; the DevTools panel passes its network list. */
  readonly extraSources?: ReactNode;
}
