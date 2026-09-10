import {
  StrictMode,
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { isLosslessNumber } from "lossless-json";
import {
  createPipeline,
  exportData,
  generatePipelineCode,
  queryJsonWithDuckDb,
  parseJsonValue,
  parsePipeline,
  PipelineHistory,
  suggestPipeline,
  stringifyJsonValue,
  validateJson,
  profileJsonStructure,
  inferJsonSchema,
  diffJson,
  type JsonObject,
  type JsonStructureEvent,
  type JsonValue,
  type PipelineDefinition,
  type PipelineStepStat,
  type JsonSchema,
  type JsonProfile,
  type JsonDiff,
  type AnalyticsQueryResult,
  type ValidationDiagnostic,
} from "@json-workbench/core";
import { ingestFile, type IngestTask } from "./ingest";
import "./app.css";

const MonacoRawEditor = lazy(() =>
  import("./MonacoRawEditor").then((module) => ({
    default: module.MonacoRawEditor,
  })),
);

type View = "tree" | "raw" | "table";
type NodeKind = "object" | "array" | "primitive";
interface ViewerNode {
  readonly path: string;
  readonly key?: string | number;
  readonly kind: NodeKind;
  readonly primitiveType?: string;
  readonly raw?: string;
  readonly children: ViewerNode[];
}

interface BridgeResponse {
  readonly ok?: boolean;
  readonly name?: string;
  readonly text?: string;
  readonly error?: string;
  readonly pending?: { readonly name: string; readonly text: string } | null;
}

interface ChromeBridge {
  readonly runtime?: {
    sendMessage: (
      message: unknown,
      callback: (response?: BridgeResponse) => void,
    ) => void;
  };
  readonly permissions?: {
    request: (
      permissions: { permissions?: string[]; origins?: string[] },
      callback: (granted: boolean) => void,
    ) => void;
    contains: (
      permissions: { permissions?: string[]; origins?: string[] },
      callback: (result: boolean) => void,
    ) => void;
    remove: (
      permissions: { permissions?: string[]; origins?: string[] },
      callback: (removed: boolean) => void,
    ) => void;
  };
  readonly tabs?: {
    query: (
      query: { active: boolean; lastFocusedWindow: boolean },
      callback: (tabs: Array<{ id?: number }>) => void,
    ) => void;
  };
}

function chromeBridge(): ChromeBridge | undefined {
  return (globalThis as typeof globalThis & { chrome?: ChromeBridge }).chrome;
}

function pointerSegment(value: string | number): string {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function buildTree(events: readonly JsonStructureEvent[]): ViewerNode[] {
  const roots: ViewerNode[] = [];
  const stack: ViewerNode[] = [];
  const nextIndexes: number[] = [];
  let pendingKey: string | undefined;
  const add = (node: ViewerNode) => {
    const parent = stack.at(-1);
    if (parent) parent.children.push(node);
    else roots.push(node);
  };
  const nodePath = (): string => {
    const parent = stack.at(-1);
    if (!parent) return "";
    const segment = parent.kind === "object" ? pendingKey : nextIndexes.at(-1);
    if (segment === undefined) return parent.path;
    return `${parent.path}/${pointerSegment(segment)}`;
  };
  for (const event of events) {
    if (event.type === "property") {
      pendingKey = event.key;
      continue;
    }
    if (event.type === "start-object" || event.type === "start-array") {
      const kind = event.type === "start-object" ? "object" : "array";
      const path = nodePath();
      const node: ViewerNode = {
        path,
        kind,
        children: [],
        ...(pendingKey !== undefined ? { key: pendingKey } : {}),
      };
      add(node);
      if (stack.at(-1)?.kind === "array")
        nextIndexes[nextIndexes.length - 1] = (nextIndexes.at(-1) ?? 0) + 1;
      pendingKey = undefined;
      stack.push(node);
      nextIndexes.push(0);
      continue;
    }
    if (event.type === "primitive") {
      const path = nodePath();
      const node: ViewerNode = {
        path,
        kind: "primitive",
        primitiveType: event.primitiveType,
        raw: event.raw,
        children: [],
        ...(pendingKey !== undefined ? { key: pendingKey } : {}),
      };
      add(node);
      if (stack.at(-1)?.kind === "array")
        nextIndexes[nextIndexes.length - 1] = (nextIndexes.at(-1) ?? 0) + 1;
      pendingKey = undefined;
      continue;
    }
    if (event.type === "end-object" || event.type === "end-array") {
      stack.pop();
      nextIndexes.pop();
    }
  }
  return roots;
}

async function* toAsyncEvents(
  events: readonly JsonStructureEvent[],
): AsyncGenerator<JsonStructureEvent> {
  for (const event of events) yield event;
}

function nodeText(node: ViewerNode): string {
  if (node.kind === "primitive") return node.raw ?? "";
  return node.kind === "array" ? `Array(${node.children.length})` : "Object";
}

function visibleNodes(
  nodes: readonly ViewerNode[],
  expanded: ReadonlySet<string>,
  query: string,
  regexSearch = false,
  depth = 0,
): Array<{ node: ViewerNode; depth: number }> {
  const result: Array<{ node: ViewerNode; depth: number }> = [];
  const needle = query.trim().toLowerCase();
  let matcher: RegExp | undefined;
  if (regexSearch && query.trim()) {
    try {
      matcher = new RegExp(query, "i");
    } catch {
      matcher = undefined;
    }
  }
  for (const node of nodes) {
    const searchable = `${node.path} ${String(node.key ?? "")} ${nodeText(node)}`;
    const matches =
      !needle ||
      (matcher
        ? matcher.test(searchable)
        : searchable.toLowerCase().includes(needle));
    const descendants = visibleNodes(
      node.children,
      expanded,
      query,
      regexSearch,
      depth + 1,
    );
    if (matches || descendants.length) result.push({ node, depth });
    if (expanded.has(node.path) || needle) result.push(...descendants);
  }
  return result;
}

function displayValue(value: JsonValue): string {
  if (isLosslessNumber(value)) return value.value;
  return stringifyJsonValue(value, false);
}

function VirtualList<T>({
  items,
  itemHeight,
  height,
  render,
}: {
  items: readonly T[];
  itemHeight: number;
  height: number;
  render: (item: T, index: number) => ReactNode;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const viewportItems = Math.ceil(height / itemHeight);
  const overscan = 8;
  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const end = Math.min(items.length, start + viewportItems + overscan * 2);
  return (
    <div
      className="virtual-list"
      style={{ maxHeight: height, overflowY: "auto" }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div style={{ height: items.length * itemHeight, position: "relative" }}>
        <div
          style={{
            position: "absolute",
            top: start * itemHeight,
            left: 0,
            right: 0,
          }}
        >
          {items
            .slice(start, end)
            .map((item, index) => render(item, start + index))}
        </div>
      </div>
    </div>
  );
}

function isObject(value: JsonValue): value is JsonObject {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !isLosslessNumber(value)
  );
}

function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const recipeInputRef = useRef<HTMLInputElement>(null);
  const taskRef = useRef<IngestTask | undefined>(undefined);
  const historyRef = useRef(new PipelineHistory(createPipeline()));
  const pipelineWorkerRef = useRef<Worker | undefined>(undefined);
  const [fileName, setFileName] = useState<string>();
  const [sourceFile, setSourceFile] = useState<File>();
  const [pasteText, setPasteText] = useState("");
  const [status, setStatus] = useState("Ready");
  const [progress, setProgress] = useState(0);
  const [eventCount, setEventCount] = useState(0);
  const [recordCount, setRecordCount] = useState(0);
  const [format, setFormat] = useState<"json" | "jsonl">("json");
  const [events, setEvents] = useState<JsonStructureEvent[]>([]);
  const [records, setRecords] = useState<JsonValue[]>([]);
  const [rawPreview, setRawPreview] = useState("");
  const [view, setView] = useState<View>("tree");
  const [query, setQuery] = useState("");
  const [regexSearch, setRegexSearch] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [pipeline, setPipeline] = useState<PipelineDefinition>(
    historyRef.current.snapshot.present,
  );
  const [pipelineResult, setPipelineResult] = useState<JsonValue>();
  const [pipelineStats, setPipelineStats] = useState<PipelineStepStat[]>([]);
  const [pipelineError, setPipelineError] = useState<string>();
  const [runMode, setRunMode] = useState<"preview" | "live" | "full">(
    "preview",
  );
  const [memoryLimitMb, setMemoryLimitMb] = useState<
    "unlimited" | "256" | "1024"
  >("unlimited");
  const [memoryBytes, setMemoryBytes] = useState(0);
  const [sqlQuery, setSqlQuery] = useState(
    "SELECT * FROM read_json_auto('source.json') LIMIT 100",
  );
  const [sqlResult, setSqlResult] = useState<AnalyticsQueryResult>();
  const [sqlError, setSqlError] = useState<string>();
  const [sqlRunning, setSqlRunning] = useState(false);
  const [schemaText, setSchemaText] = useState('{"type":"array"}');
  const [diagnostics, setDiagnostics] = useState<
    readonly ValidationDiagnostic[]
  >([]);
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [assistantSuggestion, setAssistantSuggestion] =
    useState<ReturnType<typeof suggestPipeline>>();
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [sortColumn, setSortColumn] = useState<string>();
  const [sortDescending, setSortDescending] = useState(false);
  const [codeTarget, setCodeTarget] = useState<
    "jsonata" | "jq" | "javascript" | "typescript" | "python" | "sql"
  >("jsonata");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [profile, setProfile] = useState<JsonProfile>();
  const [diffText, setDiffText] = useState("");
  const [diffResult, setDiffResult] = useState<readonly JsonDiff[]>();
  const [autoRender, setAutoRender] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("json-workbench:pipeline");
    if (saved) {
      try {
        const restored = parsePipeline(saved);
        historyRef.current = new PipelineHistory(restored);
        setPipeline(restored);
      } catch {
        localStorage.removeItem("json-workbench:pipeline");
      }
    }
    if (localStorage.getItem("json-workbench:theme") === "light")
      setTheme("light");
  }, []);

  useEffect(() => {
    const bridge = chromeBridge();
    bridge?.permissions?.contains?.({ origins: ["<all_urls>"] }, (granted) =>
      setAutoRender(Boolean(granted)),
    );
    bridge?.runtime?.sendMessage?.(
      { type: "take-pending-json" },
      (response) => {
        if (response?.pending?.text) {
          onFile(
            new File([response.pending.text], response.pending.name, {
              type: "application/json",
            }),
          );
        }
      },
    );
  }, []);

  useEffect(() => {
    localStorage.setItem(
      "json-workbench:pipeline",
      stringifyJsonValue(pipeline as unknown as JsonValue, false),
    );
  }, [pipeline]);

  useEffect(() => {
    if (!events.length) {
      setProfile(undefined);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = await profileJsonStructure(toAsyncEvents(events));
        if (!cancelled) setProfile(result);
      } catch {
        if (!cancelled) setProfile(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [events]);

  function updatePipeline(next: PipelineDefinition) {
    setPipeline(historyRef.current.update(next));
    setPipelineError(undefined);
  }

  function onFile(file: File | undefined) {
    if (!file) return;
    taskRef.current?.cancel();
    setSourceFile(file);
    setFileName(file.name);
    setStatus("Scanning…");
    setProgress(0);
    setEventCount(0);
    setRecordCount(0);
    setFormat("json");
    setEvents([]);
    setRecords([]);
    setRawPreview("");
    setPipelineResult(undefined);
    setPipelineStats([]);
    setMemoryBytes(0);
    setView("tree");
    setExpanded(new Set([""]));
    let count = 0;
    taskRef.current = ingestFile(file, {
      onEvent: (event) => {
        count++;
        setEventCount(count);
        setEvents((current) =>
          current.length < 5000 ? [...current, event] : current,
        );
      },
      onRecord: ({ index, valueText }) => {
        setRecordCount(index + 1);
        if (valueText !== undefined) {
          try {
            const value = parseJsonValue(valueText);
            setRecords((current) =>
              current.length < 1000 ? [...current, value] : current,
            );
          } catch {
            setPipelineError(`Unable to decode preview record ${index}`);
          }
        }
      },
      onPreview: ({ text }) => setRawPreview(text),
      onFormat: setFormat,
      onProgress: ({ loaded, total }) =>
        setProgress(total ? Math.round((loaded / total) * 100) : 0),
      onComplete: () => setStatus("Ready to explore"),
      onError: (error) =>
        setStatus(
          `${error.name}: ${error.message}${
            error.offset === undefined ? "" : ` at byte ${error.offset}`
          }`,
        ),
    });
  }

  function loadPastedText() {
    if (!pasteText.trim()) return;
    onFile(new File([pasteText], "pasted.json", { type: "application/json" }));
  }

  function readActiveJson() {
    const runtime = chromeBridge()?.runtime;
    if (!runtime) {
      setPipelineError("The active-tab bridge is only available in Chrome");
      return;
    }
    setStatus("Reading active JSON tab…");
    runtime.sendMessage({ type: "read-active-json" }, (response) => {
      if (!response?.ok || response.text === undefined) {
        setPipelineError(response?.error ?? "Unable to read the active tab");
        setStatus("Active tab read failed");
        return;
      }
      onFile(
        new File([response.text], response.name ?? "active.json", {
          type: "application/json",
        }),
      );
    });
  }

  function captureNextJsonResponse() {
    const bridge = chromeBridge();
    if (!bridge?.runtime || !bridge.permissions || !bridge.tabs) {
      setPipelineError(
        "Network capture is only available in the Chrome extension",
      );
      return;
    }
    setStatus("Requesting one-time network capture permission…");
    bridge.permissions.request({ permissions: ["debugger"] }, (granted) => {
      if (!granted) {
        setStatus("Network capture permission was not granted");
        return;
      }
      bridge.tabs!.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id;
        if (tabId === undefined) {
          setPipelineError("No active tab was found");
          return;
        }
        setStatus("Waiting for the next JSON response…");
        bridge.runtime!.sendMessage(
          { type: "capture-next-json-response", tabId },
          (response) => {
            if (!response?.ok || response.text === undefined) {
              setPipelineError(response?.error ?? "Network capture failed");
              setStatus("Network capture failed");
              return;
            }
            onFile(
              new File(
                [response.text],
                response.name ?? "captured-response.json",
                { type: "application/json" },
              ),
            );
          },
        );
      });
    });
  }

  function cancelWork() {
    taskRef.current?.cancel();
    pipelineWorkerRef.current?.terminate();
    setStatus("Cancelled");
  }

  function formatActiveTab() {
    const runtime = chromeBridge()?.runtime;
    if (!runtime) {
      setPipelineError(
        "Formatting the current tab is only available in the Chrome extension",
      );
      return;
    }
    setStatus("Formatting the current tab…");
    runtime.sendMessage({ type: "format-active-tab" }, (response) => {
      if (!response?.ok) {
        setPipelineError(response?.error ?? "Unable to format the active tab");
        setStatus("Format failed");
        return;
      }
      setStatus("Formatted JSON in the current tab");
    });
  }

  function toggleAutoRender(enabled: boolean) {
    const bridge = chromeBridge();
    if (!bridge?.runtime || !bridge.permissions) {
      setPipelineError("Auto-render is only available in the Chrome extension");
      return;
    }
    if (enabled) {
      bridge.permissions.request({ origins: ["<all_urls>"] }, (granted) => {
        if (!granted) {
          setStatus("Auto-render permission was not granted");
          return;
        }
        bridge.runtime!.sendMessage(
          { type: "set-auto-render", enabled: true },
          () => {
            setAutoRender(true);
            setStatus("Auto-render enabled for JSON pages");
          },
        );
      });
    } else {
      bridge.runtime.sendMessage(
        { type: "set-auto-render", enabled: false },
        () => {
          bridge.permissions!.remove({ origins: ["<all_urls>"] }, () => {
            setAutoRender(false);
            setStatus("Auto-render disabled");
          });
        },
      );
    }
  }

  const tree = useMemo(() => buildTree(events), [events]);
  const rows = useMemo(
    () => visibleNodes(tree, expanded, query, regexSearch),
    [tree, expanded, query, regexSearch],
  );
  const sourceValue = useMemo<JsonValue>(() => {
    if (format === "jsonl") return records;
    try {
      return parseJsonValue(rawPreview);
    } catch {
      return records;
    }
  }, [format, rawPreview, records]);
  const tableRecords = useMemo(() => {
    const value = pipelineResult ?? sourceValue;
    return (Array.isArray(value) ? value : []).filter(isObject);
  }, [pipelineResult, sourceValue]);
  const columns = useMemo(
    () => [...new Set(tableRecords.flatMap((record) => Object.keys(record)))],
    [tableRecords],
  );
  const filteredTableRecords = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return tableRecords;
    let matcher: RegExp | undefined;
    if (regexSearch) {
      try {
        matcher = new RegExp(query, "i");
      } catch {
        return [];
      }
    }
    return tableRecords.filter((record) => {
      const text = stringifyJsonValue(record, false);
      return matcher ? matcher.test(text) : text.toLowerCase().includes(needle);
    });
  }, [query, regexSearch, tableRecords]);
  const sortedRecords = useMemo(() => {
    if (!sortColumn) return filteredTableRecords;
    return [...filteredTableRecords].sort((left, right) => {
      const a = displayValue(left[sortColumn] ?? null);
      const b = displayValue(right[sortColumn] ?? null);
      const result = a === b ? 0 : a < b ? -1 : 1;
      return sortDescending ? -result : result;
    });
  }, [filteredTableRecords, sortColumn, sortDescending]);

  async function copy(text: string) {
    await navigator.clipboard?.writeText(text);
    setStatus("Copied to clipboard");
  }

  async function runSql() {
    setSqlRunning(true);
    setSqlError(undefined);
    try {
      const source = sourceFile
        ? await sourceFile.text()
        : stringifyJsonValue(sourceValue, false);
      const base = globalThis.location.origin.endsWith("/")
        ? globalThis.location.origin
        : `${globalThis.location.origin}/`;
      const result = await queryJsonWithDuckDb(source, sqlQuery, {
        fileName: "source.json",
        bundle: {
          mainModule: `${base}duckdb-mvp.wasm`,
          mainWorker: `${base}duckdb-browser-mvp.worker.js`,
        },
        onProgress: ({ phase }) => setStatus(`SQL: ${phase}`),
      });
      setSqlResult(result);
      setStatus(
        `SQL complete · ${result.rows.length.toLocaleString()} rows · ${Math.round(result.durationMs ?? 0)}ms`,
      );
    } catch (error) {
      setSqlError(error instanceof Error ? error.message : String(error));
      setStatus("SQL failed");
    } finally {
      setSqlRunning(false);
    }
  }

  async function runPreview() {
    const input: JsonValue | undefined =
      runMode === "full"
        ? undefined
        : format === "jsonl"
          ? records
          : (() => {
              try {
                return parseJsonValue(rawPreview);
              } catch {
                return records;
              }
            })();
    pipelineWorkerRef.current?.terminate();
    setPipelineError(undefined);
    setPipelineStats([]);
    setMemoryBytes(0);
    setStatus("Running preview…");
    try {
      const result = await new Promise<JsonValue>((resolve, reject) => {
        const worker = new Worker(
          new URL("./pipeline.worker.ts", import.meta.url),
          { type: "module" },
        );
        pipelineWorkerRef.current = worker;
        worker.onmessage = (message: MessageEvent) => {
          const data = message.data as {
            type: "stat" | "progress" | "memory" | "complete" | "error";
            stat?: PipelineStepStat;
            resultText?: string;
            name?: string;
            message?: string;
            completed?: number;
            total?: number;
            stepIndex?: number;
            bytes?: number;
          };
          if (data.type === "stat" && data.stat)
            setPipelineStats((current) => [...current, data.stat!]);
          else if (data.type === "memory" && data.bytes !== undefined)
            setMemoryBytes(data.bytes);
          else if (
            data.type === "progress" &&
            data.stepIndex === -1 &&
            data.total
          ) {
            setStatus(
              `Reading full file… ${Math.round(((data.completed ?? 0) / data.total) * 100)}%`,
            );
          } else if (
            data.type === "complete" &&
            data.resultText !== undefined
          ) {
            worker.terminate();
            resolve(parseJsonValue(data.resultText));
          } else if (data.type === "error") {
            worker.terminate();
            const error = new Error(
              data.message ?? "Pipeline execution failed",
            );
            error.name = data.name ?? "PipelineError";
            reject(error);
          }
        };
        worker.onerror = (event) => {
          worker.terminate();
          reject(new Error(event.message || "Pipeline worker failed"));
        };
        worker.postMessage({
          type: "run",
          ...(runMode === "full" && sourceFile
            ? { file: sourceFile }
            : { inputText: stringifyJsonValue(input ?? [], false) }),
          pipelineText: stringifyJsonValue(
            pipeline as unknown as JsonValue,
            false,
          ),
          mode: runMode,
          ...(memoryLimitMb === "unlimited"
            ? {}
            : { maxMaterializedBytes: Number(memoryLimitMb) * 1024 * 1024 }),
        });
      });
      setPipelineResult(result);
      setStatus("Preview ready");
    } catch (error) {
      setPipelineError(error instanceof Error ? error.message : String(error));
      setStatus("Preview failed");
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        inputRef.current?.click();
      } else if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void runPreview();
      } else if (event.key === "Escape") {
        cancelWork();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [format, pipeline, rawPreview, records, runMode, sourceFile]);

  function addStep(type: string) {
    const defaults: Record<string, JsonObject> = {
      filter: { field: "id", equals: 1 },
      map: { mapping: { value: "name" } },
      pick: { fields: ["id", "name"] },
      remove: { fields: ["internal"] },
      rename: { from: "name", to: "label" },
      add: { key: "reviewed", value: true },
      sort: { field: "id", descending: false },
      distinct: { field: "id" },
      deduplicate: { field: "id" },
      group: { field: "status" },
      flatten: { prefix: "" },
      unflatten: { separator: "." },
      replace: { field: "status", from: "draft", to: "review" },
      regex: { field: "name", pattern: "^", replacement: "", flags: "g" },
      "type-convert": { field: "id", target: "string" },
      extract: { field: "name" },
      aggregate: { field: "id", operation: "sum" },
      jsonata: { expression: "$" },
      jq: { expression: "." },
    };
    updatePipeline(
      createPipeline([
        ...pipeline.steps,
        {
          id: `${type}-${Date.now()}`,
          type,
          enabled: true,
          config: defaults[type] ?? {},
        },
      ]),
    );
  }

  function updateStepConfig(index: number, text: string) {
    try {
      const value = parseJsonValue(text);
      if (!isObject(value)) throw new Error("Step config must be an object");
      updatePipeline(
        createPipeline(
          pipeline.steps.map((step, stepIndex) =>
            stepIndex === index ? { ...step, config: value } : step,
          ),
        ),
      );
    } catch (error) {
      setPipelineError(error instanceof Error ? error.message : String(error));
    }
  }

  function exportRecipe() {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([stringifyJsonValue(pipeline as unknown as JsonValue, true)], {
        type: "application/json",
      }),
    );
    link.download = "json-workbench.recipe.json";
    link.click();
    URL.revokeObjectURL(link.href);
    setStatus("Recipe exported");
  }

  async function importRecipe(file: File | undefined) {
    if (!file) return;
    try {
      const restored = parsePipeline(await file.text());
      historyRef.current = new PipelineHistory(restored);
      setPipeline(restored);
      setStatus("Recipe loaded");
    } catch (error) {
      setPipelineError(error instanceof Error ? error.message : String(error));
    }
  }

  function exportCurrent(
    formatToExport: "json" | "jsonl" | "ndjson" | "csv" | "tsv",
  ) {
    const value =
      pipelineResult ??
      (format === "jsonl" ? records : parseJsonValue(rawPreview));
    const text = exportData(value, formatToExport, { pretty: true });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([text], { type: "application/json" }),
    );
    link.download = `json-workbench.${formatToExport === "json" ? "json" : formatToExport}`;
    link.click();
    URL.revokeObjectURL(link.href);
    setStatus(`Exported ${formatToExport.toUpperCase()}`);
  }

  function validateCurrent() {
    try {
      const value =
        pipelineResult ??
        (format === "jsonl" ? records : parseJsonValue(rawPreview));
      const schema = parseJsonValue(schemaText) as unknown as JsonSchema;
      const result = validateJson(value, schema);
      setDiagnostics(result);
      setStatus(
        result.length
          ? `${result.length} validation issue${result.length === 1 ? "" : "s"}`
          : "Validation passed",
      );
    } catch (error) {
      setPipelineError(error instanceof Error ? error.message : String(error));
    }
  }

  async function inferSchemaFromSource() {
    try {
      const generated = await inferJsonSchema(toAsyncEvents(events));
      setSchemaText(
        stringifyJsonValue(generated as unknown as JsonValue, true),
      );
      setStatus("Schema inferred from preview");
    } catch (error) {
      setPipelineError(error instanceof Error ? error.message : String(error));
    }
  }

  function runDiff() {
    try {
      const left = sourceValue;
      const right = diffText.trim() ? parseJsonValue(diffText) : pipelineResult;
      if (right === undefined) {
        setPipelineError(
          "Run a pipeline preview or paste JSON to compare against the source.",
        );
        return;
      }
      const changes = diffJson(left, right);
      setDiffResult(changes);
      setStatus(
        changes.length
          ? `${changes.length} difference${changes.length === 1 ? "" : "s"} found`
          : "No differences",
      );
    } catch (error) {
      setPipelineError(error instanceof Error ? error.message : String(error));
    }
  }

  const shellClass = `shell ${theme}`;
  return (
    <main className={shellClass}>
      <header className="topbar">
        <div className="brand">
          <div className="eyebrow">LOCAL-FIRST DEVELOPER TOOL</div>
          <h1>JSON Workbench</h1>
        </div>
        <div className="top-actions">
          <span className="status" role="status" aria-live="polite">
            {status}
          </span>
          <button
            className="icon-button"
            type="button"
            onClick={() => {
              const next = theme === "dark" ? "light" : "dark";
              setTheme(next);
              localStorage.setItem("json-workbench:theme", next);
            }}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "☼" : "☾"}
          </button>
          <div className="settings-wrap">
            <button
              className="icon-button"
              type="button"
              onClick={() => setSettingsOpen((open) => !open)}
              aria-label="Settings"
              aria-expanded={settingsOpen}
              data-testid="settings-button"
            >
              ⚙
            </button>
            {settingsOpen && (
              <div className="settings-panel" data-testid="settings-panel">
                <div className="card-label">PAGE INTEGRATION</div>
                <label className="settings-row">
                  <input
                    type="checkbox"
                    checked={autoRender}
                    onChange={(event) => toggleAutoRender(event.target.checked)}
                    data-testid="auto-render-toggle"
                  />
                  <span>
                    <strong>Auto-render JSON pages</strong>
                    <span className="muted">
                      Format any JSON page you open, in place. Requests access
                      to all sites (granted at toggle time, revoked when off).
                    </span>
                  </span>
                </label>
                <button
                  className="secondary"
                  type="button"
                  onClick={formatActiveTab}
                  data-testid="format-tab-button"
                >
                  Format current tab now
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <section className="workspace">
        <div className="source-bar">
          <div className="source-file">
            <span className="file-icon">{fileName ? "✓" : "{}"}</span>
            <div>
              <strong>{fileName ?? "No source loaded"}</strong>
              <span>
                {fileName
                  ? `${format.toUpperCase()} · ${progress}% · ${format === "jsonl" ? `${recordCount.toLocaleString()} records` : `${eventCount.toLocaleString()} structural events`}`
                  : "Choose a local JSON, JSONL, or NDJSON file"}
              </span>
            </div>
          </div>
          <div className="source-actions">
            <button type="button" onClick={() => inputRef.current?.click()}>
              Open file
            </button>
            <button
              className="secondary"
              type="button"
              onClick={readActiveJson}
            >
              Active JSON tab
            </button>
            <button
              className="secondary"
              type="button"
              onClick={captureNextJsonResponse}
            >
              Capture next JSON response
            </button>
            <button className="secondary" type="button" onClick={cancelWork}>
              Cancel
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".json,.jsonl,.ndjson,application/json"
              hidden
              onChange={(event) => onFile(event.target.files?.[0])}
            />
          </div>
        </div>
        {!fileName ? (
          <div
            className="empty-state"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              onFile(event.dataTransfer.files[0]);
            }}
          >
            <div className="empty-icon">{`{ }`}</div>
            <h2>Open a JSON dataset</h2>
            <p>
              Drop a JSON, JSONL, or NDJSON file to inspect, transform,
              validate, and export it. Parsing stays on-device and off the UI
              thread.
            </p>
            <button type="button" onClick={() => inputRef.current?.click()}>
              Choose file
            </button>
            <div className="paste-box">
              <textarea
                value={pasteText}
                onChange={(event) => setPasteText(event.target.value)}
                placeholder="Or paste JSON / JSONL here"
                spellCheck={false}
              />
              <div className="inline-actions">
                <button
                  className="secondary"
                  type="button"
                  onClick={loadPastedText}
                >
                  Load pasted text
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={async () => {
                    const text = await navigator.clipboard?.readText();
                    if (text) setPasteText(text);
                  }}
                >
                  Paste from clipboard
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <nav className="view-tabs" aria-label="Data views">
              {(["tree", "raw", "table"] as const).map((item) => (
                <button
                  key={item}
                  className={view === item ? "tab active" : "tab"}
                  type="button"
                  onClick={() => setView(item)}
                >
                  {item === "tree"
                    ? "Tree"
                    : item === "raw"
                      ? "Raw / code"
                      : "Table"}
                </button>
              ))}
              <div className="search">
                <span>⌕</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search values or paths"
                  aria-label="Search values or paths"
                />
                <label className="regex-toggle">
                  <input
                    type="checkbox"
                    checked={regexSearch}
                    onChange={(event) => setRegexSearch(event.target.checked)}
                  />
                  Regex
                </label>
              </div>
            </nav>
            <div className="content-grid">
              <section className="viewer-card">
                <div className="card-heading">
                  <div>
                    <span className="card-label">
                      {view === "table"
                        ? "TABULAR PREVIEW"
                        : view === "raw"
                          ? "SOURCE PREVIEW"
                          : "STRUCTURE"}
                    </span>
                    <h2>
                      {pipelineResult !== undefined
                        ? "Pipeline result"
                        : "Source preview"}
                    </h2>
                  </div>
                  <span className="muted">
                    {format === "jsonl" && records.length < recordCount
                      ? "first 1,000 records"
                      : "lossless preview"}
                  </span>
                </div>
                {view === "tree" && (
                  <div className="tree" role="tree">
                    {rows.length ? (
                      <VirtualList
                        items={rows}
                        itemHeight={34}
                        height={560}
                        render={({ node, depth }) => (
                          <div
                            className="tree-row"
                            role="treeitem"
                            aria-expanded={
                              node.kind === "primitive"
                                ? undefined
                                : expanded.has(node.path)
                            }
                            aria-level={depth + 1}
                            key={`${node.path}-${depth}`}
                            style={{ paddingLeft: `${16 + depth * 22}px` }}
                          >
                            <button
                              className="expand"
                              type="button"
                              onClick={() =>
                                setExpanded((current) => {
                                  const next = new Set(current);
                                  if (next.has(node.path))
                                    next.delete(node.path);
                                  else next.add(node.path);
                                  return next;
                                })
                              }
                              aria-label={`${expanded.has(node.path) ? "Collapse" : "Expand"} ${node.path || "root"}`}
                            >
                              {node.kind === "primitive"
                                ? "·"
                                : expanded.has(node.path)
                                  ? "⌄"
                                  : "›"}
                            </button>
                            <span className="type-pill">
                              {node.kind === "primitive"
                                ? node.primitiveType?.slice(0, 3)
                                : node.kind === "array"
                                  ? "arr"
                                  : "obj"}
                            </span>
                            <button
                              className="path-button"
                              type="button"
                              onClick={() => copy(node.path || "/")}
                            >
                              {node.key === undefined
                                ? node.path || "$"
                                : String(node.key)}
                            </button>
                            <span
                              className={`value ${node.primitiveType === "null" ? "null-value" : ""}`}
                            >
                              {nodeText(node)}
                            </span>
                            <button
                              className="copy-button"
                              type="button"
                              onClick={() =>
                                copy(
                                  node.kind === "primitive"
                                    ? (node.raw ?? "")
                                    : node.path || "/",
                                )
                              }
                              aria-label="Copy value"
                            >
                              ⧉
                            </button>
                          </div>
                        )}
                      />
                    ) : (
                      <div className="no-results">
                        No preview rows yet. The parser may still be working, or
                        the input is malformed.
                      </div>
                    )}
                  </div>
                )}
                {view === "raw" && (
                  <div className="raw-view">
                    <Suspense
                      fallback={<pre>{rawPreview || "Loading editor…"}</pre>}
                    >
                      <MonacoRawEditor
                        dark={theme === "dark"}
                        value={rawPreview}
                        onChange={(value) => {
                          if (value !== undefined) setRawPreview(value);
                        }}
                      />
                    </Suspense>
                  </div>
                )}
                {view === "table" && (
                  <TableView
                    records={sortedRecords}
                    columns={columns}
                    hiddenColumns={hiddenColumns}
                    selectedRows={selectedRows}
                    onToggleColumn={(column) =>
                      setHiddenColumns((current) => {
                        const next = new Set(current);
                        if (next.has(column)) next.delete(column);
                        else next.add(column);
                        return next;
                      })
                    }
                    onSort={(column) => {
                      if (sortColumn === column)
                        setSortDescending((current) => !current);
                      else {
                        setSortColumn(column);
                        setSortDescending(false);
                      }
                    }}
                    onSelect={(index) =>
                      setSelectedRows((current) => {
                        const next = new Set(current);
                        if (next.has(index)) next.delete(index);
                        else next.add(index);
                        return next;
                      })
                    }
                  />
                )}
              </section>
              <aside className="side-column">
                <section className="panel" data-testid="insights-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="card-label">INSIGHTS</span>
                      <h2>Structure profile</h2>
                    </div>
                    <span className="muted">from preview</span>
                  </div>
                  {profile ? (
                    <>
                      <div
                        className="metric-grid"
                        data-testid="insights-metrics"
                      >
                        <div className="metric">
                          <span className="metric-value">
                            {profile.objects.toLocaleString()}
                          </span>
                          <span className="metric-label">objects</span>
                        </div>
                        <div className="metric">
                          <span className="metric-value">
                            {profile.arrays.toLocaleString()}
                          </span>
                          <span className="metric-label">arrays</span>
                        </div>
                        <div className="metric">
                          <span className="metric-value">
                            {profile.primitives.toLocaleString()}
                          </span>
                          <span className="metric-label">values</span>
                        </div>
                        <div className="metric">
                          <span className="metric-value">
                            {profile.maxDepth.toLocaleString()}
                          </span>
                          <span className="metric-label">max depth</span>
                        </div>
                      </div>
                      {Object.keys(profile.fieldStats).length > 0 && (
                        <div
                          className="field-stats"
                          data-testid="insights-fields"
                        >
                          <div className="field-stats-head">
                            <span>field</span>
                            <span>types</span>
                            <span>present</span>
                          </div>
                          {Object.entries(profile.fieldStats)
                            .sort((a, b) => b[1].occurrences - a[1].occurrences)
                            .slice(0, 40)
                            .map(([field, stat]) => (
                              <button
                                className="field-row"
                                type="button"
                                key={field}
                                onClick={() => setQuery(field)}
                                title="Search this field"
                              >
                                <span className="field-name">{field}</span>
                                <span className="field-types">
                                  {stat.types.join(", ") || "—"}
                                  {stat.inconsistent && (
                                    <span className="badge warn">mixed</span>
                                  )}
                                  {stat.nulls > 0 && (
                                    <span className="badge">
                                      {stat.nulls} null
                                    </span>
                                  )}
                                </span>
                                <span
                                  className={`field-present ${stat.missing > 0 ? "partial" : ""}`}
                                >
                                  {stat.occurrences}
                                  {stat.missing > 0
                                    ? ` / ${stat.occurrences + stat.missing}`
                                    : ""}
                                </span>
                              </button>
                            ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="muted panel-copy">
                      Load JSON to profile field types, presence, null counts,
                      and type inconsistencies.
                    </p>
                  )}
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <span className="card-label">TRANSFORM</span>
                      <h2>Pipeline</h2>
                    </div>
                    <div className="inline-actions">
                      <button
                        className="icon-button"
                        type="button"
                        disabled={!historyRef.current.snapshot.past.length}
                        onClick={() => setPipeline(historyRef.current.undo())}
                        aria-label="Undo pipeline change"
                      >
                        ↶
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        disabled={!historyRef.current.snapshot.future.length}
                        onClick={() => setPipeline(historyRef.current.redo())}
                        aria-label="Redo pipeline change"
                      >
                        ↷
                      </button>
                      <button
                        className="link-button"
                        type="button"
                        onClick={exportRecipe}
                      >
                        Save
                      </button>
                      <button
                        className="link-button"
                        type="button"
                        onClick={() => recipeInputRef.current?.click()}
                      >
                        Load
                      </button>
                      <input
                        ref={recipeInputRef}
                        type="file"
                        accept="application/json,.json"
                        hidden
                        onChange={(event) => {
                          void importRecipe(event.target.files?.[0]);
                          event.target.value = "";
                        }}
                      />
                    </div>
                  </div>
                  <div className="step-buttons">
                    <button type="button" onClick={() => addStep("filter")}>
                      + Filter
                    </button>
                    <button type="button" onClick={() => addStep("map")}>
                      + Map
                    </button>
                    <button type="button" onClick={() => addStep("add")}>
                      + Add
                    </button>
                    <button type="button" onClick={() => addStep("pick")}>
                      + Pick
                    </button>
                    <button type="button" onClick={() => addStep("remove")}>
                      + Remove
                    </button>
                    <button type="button" onClick={() => addStep("rename")}>
                      + Rename
                    </button>
                    <button type="button" onClick={() => addStep("sort")}>
                      + Sort
                    </button>
                    <button type="button" onClick={() => addStep("distinct")}>
                      + Distinct
                    </button>
                    <button type="button" onClick={() => addStep("group")}>
                      + Group
                    </button>
                    <button type="button" onClick={() => addStep("flatten")}>
                      + Flatten
                    </button>
                    <button type="button" onClick={() => addStep("regex")}>
                      + Regex
                    </button>
                    <button type="button" onClick={() => addStep("jsonata")}>
                      + JSONata
                    </button>
                    <button type="button" onClick={() => addStep("jq")}>
                      + jq
                    </button>
                  </div>
                  {pipeline.steps.length === 0 ? (
                    <p className="muted panel-copy">
                      Add a step to preview a reproducible transformation.
                      Disabled steps remain in the saved recipe.
                    </p>
                  ) : (
                    <div className="steps">
                      {pipeline.steps.map((step, index) => (
                        <div
                          className={`step ${step.enabled ? "" : "disabled"}`}
                          key={step.id}
                        >
                          <div className="step-title">
                            <button
                              className="toggle"
                              type="button"
                              onClick={() =>
                                setPipeline(
                                  historyRef.current.setEnabled(
                                    index,
                                    !step.enabled,
                                  ),
                                )
                              }
                              aria-label={`${step.enabled ? "Disable" : "Enable"} step ${index + 1}`}
                            >
                              {step.enabled ? "●" : "○"}
                            </button>
                            <strong>
                              {index + 1}. {step.type}
                            </strong>
                            <span className="muted">
                              {step.execution?.kind ?? "materializing"}
                            </span>
                          </div>
                          <textarea
                            key={`${step.id}-${stringifyJsonValue(step.config)}`}
                            className="step-config"
                            defaultValue={stringifyJsonValue(step.config, true)}
                            aria-label={`Configuration for step ${index + 1}`}
                            spellCheck={false}
                            onBlur={(event) =>
                              updateStepConfig(index, event.target.value)
                            }
                          />
                          <div className="step-actions">
                            <button
                              className="link-button"
                              type="button"
                              onClick={() =>
                                setPipeline(
                                  historyRef.current.reorder(
                                    index,
                                    Math.max(0, index - 1),
                                  ),
                                )
                              }
                              aria-label={`Move step ${index + 1} up`}
                            >
                              ↑
                            </button>
                            <button
                              className="link-button"
                              type="button"
                              onClick={() =>
                                setPipeline(
                                  historyRef.current.reorder(
                                    index,
                                    Math.min(pipeline.steps.length, index + 1),
                                  ),
                                )
                              }
                              aria-label={`Move step ${index + 1} down`}
                            >
                              ↓
                            </button>
                            <button
                              className="link-button"
                              type="button"
                              onClick={() =>
                                setPipeline(historyRef.current.duplicate(index))
                              }
                            >
                              Duplicate
                            </button>
                            <button
                              className="link-button"
                              type="button"
                              onClick={() =>
                                setPipeline(historyRef.current.remove(index))
                              }
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="run-controls">
                    <label>
                      Mode{" "}
                      <select
                        value={runMode}
                        onChange={(event) =>
                          setRunMode(event.target.value as typeof runMode)
                        }
                      >
                        <option value="preview">Preview</option>
                        <option value="live">Live sample</option>
                        <option value="full">Full</option>
                      </select>
                    </label>
                    <label>
                      Memory cap{" "}
                      <select
                        value={memoryLimitMb}
                        onChange={(event) =>
                          setMemoryLimitMb(
                            event.target.value as typeof memoryLimitMb,
                          )
                        }
                      >
                        <option value="unlimited">Unlimited</option>
                        <option value="256">256 MB</option>
                        <option value="1024">1 GB</option>
                      </select>
                    </label>
                    <button
                      className="run-button"
                      type="button"
                      onClick={runPreview}
                    >
                      Run preview
                    </button>
                  </div>
                  {pipelineError && (
                    <div className="error-box">{pipelineError}</div>
                  )}
                  {pipelineStats.length > 0 && (
                    <div className="stats-list">
                      {pipelineStats.map((stat) => (
                        <span key={`${stat.stepId}-${stat.status}`}>
                          {stat.type}: {stat.status} ·{" "}
                          {stat.durationMs.toFixed(1)}ms
                          {stat.memoryBytes === undefined
                            ? ""
                            : ` · ${Math.ceil(stat.memoryBytes / 1024)} KiB`}
                        </span>
                      ))}
                      {memoryBytes > 0 && (
                        <span>
                          retained: {Math.ceil(memoryBytes / 1024)} KiB
                        </span>
                      )}
                    </div>
                  )}
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <span className="card-label">EXPORT</span>
                      <h2>Download result</h2>
                    </div>
                  </div>
                  <div className="export-grid">
                    {(["json", "jsonl", "ndjson", "csv", "tsv"] as const).map(
                      (item) => (
                        <button
                          className="secondary"
                          type="button"
                          key={item}
                          onClick={() => exportCurrent(item)}
                        >
                          {item.toUpperCase()}
                        </button>
                      ),
                    )}
                  </div>
                  <div className="codegen">
                    <label>
                      Generate recipe for{" "}
                      <select
                        value={codeTarget}
                        onChange={(event) =>
                          setCodeTarget(event.target.value as typeof codeTarget)
                        }
                      >
                        <option value="jsonata">JSONata</option>
                        <option value="jq">jq</option>
                        <option value="javascript">JavaScript</option>
                        <option value="typescript">TypeScript</option>
                        <option value="python">Python</option>
                        <option value="sql">SQL</option>
                      </select>
                    </label>
                    <pre>{generatePipelineCode(pipeline, codeTarget)}</pre>
                    <button
                      className="secondary"
                      type="button"
                      onClick={() =>
                        copy(generatePipelineCode(pipeline, codeTarget))
                      }
                    >
                      Copy generated code
                    </button>
                  </div>
                </section>
                <section className="panel sql-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="card-label">ANALYZE</span>
                      <h2>Local SQL</h2>
                    </div>
                    <span className="muted">DuckDB-WASM</span>
                  </div>
                  <textarea
                    className="sql-input"
                    value={sqlQuery}
                    onChange={(event) => setSqlQuery(event.target.value)}
                    spellCheck={false}
                    aria-label="SQL query"
                  />
                  <button
                    className="run-button"
                    type="button"
                    disabled={sqlRunning}
                    onClick={() => void runSql()}
                  >
                    {sqlRunning ? "Running SQL…" : "Run local SQL"}
                  </button>
                  {sqlError && <div className="error-box">{sqlError}</div>}
                  {sqlResult && (
                    <div className="sql-result">
                      <div className="muted">
                        {sqlResult.rows.length.toLocaleString()} rows ·{" "}
                        {Math.round(sqlResult.durationMs ?? 0)}ms
                      </div>
                      <div className="sql-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              {sqlResult.columns.map((column) => (
                                <th key={column}>{column}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {sqlResult.rows.slice(0, 100).map((row, index) => (
                              <tr key={index}>
                                {sqlResult.columns.map((column) => (
                                  <td key={column}>
                                    {displayValue(row[column] ?? null)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <span className="card-label">VALIDATE</span>
                      <h2>JSON Schema</h2>
                    </div>
                  </div>
                  <textarea
                    className="schema-input"
                    value={schemaText}
                    onChange={(event) => setSchemaText(event.target.value)}
                    spellCheck={false}
                  />
                  <div className="inline-actions">
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => void inferSchemaFromSource()}
                      data-testid="infer-schema-button"
                    >
                      Infer schema
                    </button>
                    <button
                      className="run-button"
                      type="button"
                      onClick={validateCurrent}
                    >
                      Validate current result
                    </button>
                  </div>
                  {diagnostics.length ? (
                    <div className="diagnostic-list">
                      {diagnostics.slice(0, 30).map((diagnostic) => (
                        <button
                          className="diagnostic"
                          type="button"
                          key={`${diagnostic.pointer}-${diagnostic.keyword}`}
                          onClick={() => setQuery(diagnostic.pointer)}
                        >
                          <strong>{diagnostic.pointer}</strong>{" "}
                          {diagnostic.message}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="muted panel-copy">
                      Schema checks stay local and point back to JSON Pointer
                      paths.
                    </p>
                  )}
                </section>
                <section className="panel" data-testid="diff-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="card-label">DIFF</span>
                      <h2>Compare &amp; patch</h2>
                    </div>
                    <span className="muted">JSON Patch</span>
                  </div>
                  <p className="muted panel-copy">
                    Compares the source against your pipeline result. Paste JSON
                    below to compare against that instead.
                  </p>
                  <textarea
                    className="schema-input"
                    value={diffText}
                    onChange={(event) => setDiffText(event.target.value)}
                    placeholder="Optional: paste JSON to compare against the source"
                    spellCheck={false}
                    data-testid="diff-input"
                  />
                  <button
                    className="run-button"
                    type="button"
                    onClick={runDiff}
                    data-testid="diff-run-button"
                  >
                    Compute diff
                  </button>
                  {diffResult &&
                    (diffResult.length ? (
                      <div
                        className="diagnostic-list"
                        data-testid="diff-results"
                      >
                        {diffResult.slice(0, 50).map((change, index) => (
                          <button
                            className="diagnostic"
                            type="button"
                            key={`${change.op}-${change.path}-${index}`}
                            onClick={() => setQuery(change.path)}
                          >
                            <span className={`badge op-${change.op}`}>
                              {change.op}
                            </span>{" "}
                            <strong>{change.path || "/"}</strong>{" "}
                            {change.op !== "remove" &&
                              change.value !== undefined && (
                                <span className="muted">
                                  → {displayValue(change.value)}
                                </span>
                              )}
                          </button>
                        ))}
                        {diffResult.length > 50 && (
                          <p className="muted panel-copy">
                            Showing first 50 of {diffResult.length} changes.
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="muted panel-copy">
                        No differences between the two inputs.
                      </p>
                    ))}
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <span className="card-label">ASSISTANT</span>
                      <h2>Build a recipe locally</h2>
                    </div>
                  </div>
                  <input
                    className="assistant-input"
                    value={assistantPrompt}
                    onChange={(event) => setAssistantPrompt(event.target.value)}
                    placeholder="e.g. filter active = true"
                  />
                  <button
                    className="run-button"
                    type="button"
                    onClick={() =>
                      setAssistantSuggestion(suggestPipeline(assistantPrompt))
                    }
                  >
                    Generate suggestion
                  </button>
                  {assistantSuggestion && (
                    <div className="assistant-result">
                      <p className="muted">{assistantSuggestion.explanation}</p>
                      <code>
                        {JSON.stringify(assistantSuggestion.definition.steps)}
                      </code>
                      {assistantSuggestion.supported && (
                        <button
                          type="button"
                          onClick={() => {
                            updatePipeline(
                              createPipeline([
                                ...pipeline.steps,
                                ...assistantSuggestion.definition.steps,
                              ]),
                            );
                            setStatus("Suggestion added for review");
                          }}
                        >
                          Review and add
                        </button>
                      )}
                    </div>
                  )}
                </section>
              </aside>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function TableView({
  records,
  columns,
  hiddenColumns,
  selectedRows,
  onToggleColumn,
  onSort,
  onSelect,
}: {
  records: JsonObject[];
  columns: string[];
  hiddenColumns: ReadonlySet<string>;
  selectedRows: ReadonlySet<number>;
  onToggleColumn: (column: string) => void;
  onSort: (column: string) => void;
  onSelect: (index: number) => void;
}) {
  const visibleColumns = columns.filter((column) => !hiddenColumns.has(column));
  const [scrollTop, setScrollTop] = useState(0);
  const rowHeight = 34;
  const viewportRows = 18;
  const overscan = 8;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(records.length, start + viewportRows + overscan * 2);
  const visibleRecords = records.slice(start, end);
  return (
    <div className="table-wrap">
      <div className="column-controls">
        {columns.map((column) => (
          <label key={column}>
            <input
              type="checkbox"
              checked={!hiddenColumns.has(column)}
              onChange={() => onToggleColumn(column)}
            />
            {column}
          </label>
        ))}
      </div>
      {records.length ? (
        <div
          className="table-scroll"
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <table>
            <thead>
              <tr>
                <th>#</th>
                {visibleColumns.map((column) => (
                  <th key={column}>
                    <button
                      className="table-sort"
                      type="button"
                      onClick={() => onSort(column)}
                    >
                      {column} ↕
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {start > 0 && (
                <tr aria-hidden="true">
                  <td
                    colSpan={visibleColumns.length + 1}
                    style={{ height: start * rowHeight, padding: 0 }}
                  />
                </tr>
              )}
              {visibleRecords.map((record, index) => (
                <tr
                  className={selectedRows.has(start + index) ? "selected" : ""}
                  key={start + index}
                  onClick={() => onSelect(start + index)}
                >
                  <td>{start + index + 1}</td>
                  {visibleColumns.map((column) => (
                    <td key={column}>{displayValue(record[column] ?? null)}</td>
                  ))}
                </tr>
              ))}
              {end < records.length && (
                <tr aria-hidden="true">
                  <td
                    colSpan={visibleColumns.length + 1}
                    style={{
                      height: (records.length - end) * rowHeight,
                      padding: 0,
                    }}
                  />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="no-results">
          Table view is available for arrays of object records.
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
