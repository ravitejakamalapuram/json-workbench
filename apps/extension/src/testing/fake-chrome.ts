// A typed in-memory fake of the chrome APIs the extension uses, for unit tests
// of platform/, background/, devtools/ and anything else that touches `chrome`. Calls are
// vi.fn spies, so a test can assert on them or replace one result. Values are
// structured-cloned on the way in and out, as chrome.storage serializes them.
import { vi } from "vitest";

const EXTENSION_ID = "fakeextensionid";
/** chrome.storage.session's quota (10 MiB). */
const SESSION_QUOTA_BYTES = 10 * 1024 * 1024;

export type FakeEvent<Args extends unknown[]> = {
  readonly listeners: Set<(...args: Args) => unknown>;
  addListener(listener: (...args: Args) => unknown): void;
  removeListener(listener: (...args: Args) => unknown): void;
  hasListener(listener: (...args: Args) => unknown): boolean;
  /** Calls every listener, as Chrome would. */
  dispatch(...args: Args): void;
};

function fakeEvent<Args extends unknown[]>(): FakeEvent<Args> {
  const listeners = new Set<(...args: Args) => unknown>();
  return {
    listeners,
    addListener: (listener) => void listeners.add(listener),
    removeListener: (listener) => void listeners.delete(listener),
    hasListener: (listener) => listeners.has(listener),
    dispatch: (...args) => listeners.forEach((listener) => listener(...args)),
  };
}

function fakeArea(quotaBytes = Infinity) {
  const data = new Map<string, unknown>();
  const keysOf = (keys?: string | string[] | null) =>
    keys == null ? [...data.keys()] : typeof keys === "string" ? [keys] : keys;
  const bytes = () =>
    new TextEncoder().encode(JSON.stringify(Object.fromEntries(data))).length;
  const area = {
    /** The stored items; tests read and seed it directly. */
    data,
    accessLevel: "TRUSTED_CONTEXTS",
    get: vi.fn(async (keys?: string | string[] | null) =>
      Object.fromEntries(
        keysOf(keys)
          .filter((key) => data.has(key))
          .map((key) => [key, structuredClone(data.get(key))]),
      ),
    ),
    set: vi.fn(async (items: Record<string, unknown>) => {
      const before = new Map(data);
      for (const [key, value] of Object.entries(items))
        data.set(key, structuredClone(value));
      if (bytes() > quotaBytes) {
        data.clear();
        before.forEach((value, key) => data.set(key, value));
        throw new Error("Resource::kQuotaBytes quota exceeded");
      }
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      keysOf(keys).forEach((key) => data.delete(key));
    }),
    clear: vi.fn(async () => data.clear()),
    setAccessLevel: vi.fn(async (options: { accessLevel: string }) => {
      area.accessLevel = options.accessLevel;
    }),
  };
  return area;
}

export type FakeArea = ReturnType<typeof fakeArea>;

export type FakePanel = {
  readonly onShown: FakeEvent<[window: Window]>;
  readonly onHidden: FakeEvent<[]>;
};

function createFakeChrome() {
  const created: FakePanel[] = [];
  const local = fakeArea();
  const session = fakeArea(SESSION_QUOTA_BYTES);
  const granted = new Set<string>();
  const covers = (origin: string) =>
    granted.has(origin) || granted.has("<all_urls>");
  let nextTabId = 1;
  return {
    storage: { local, session },
    runtime: {
      id: EXTENSION_ID,
      getURL: (path: string) => `chrome-extension://${EXTENSION_ID}/${path}`,
      sendMessage: vi.fn(async (_message: unknown): Promise<unknown> => {
        return undefined;
      }),
      onMessage:
        fakeEvent<
          [
            message: unknown,
            sender: chrome.runtime.MessageSender,
            sendResponse: (reply: unknown) => void,
          ]
        >(),
    },
    permissions: {
      /** Origins the user has granted; tests seed it directly. */
      granted,
      contains: vi.fn(async ({ origins = [] }: { origins?: string[] }) =>
        origins.every(covers),
      ),
      /** Resolves true and grants by default; mockResolvedValueOnce(false) for a denial. */
      request: vi.fn(async ({ origins = [] }: { origins?: string[] }) => {
        origins.forEach((origin) => granted.add(origin));
        return true;
      }),
      remove: vi.fn(async ({ origins = [] }: { origins?: string[] }) => {
        origins.forEach((origin) => granted.delete(origin));
        return true;
      }),
      getAll: vi.fn(async () => ({ origins: [...granted], permissions: [] })),
      onAdded: fakeEvent<[permissions: chrome.permissions.Permissions]>(),
      onRemoved: fakeEvent<[permissions: chrome.permissions.Permissions]>(),
    },
    tabs: {
      create: vi.fn(async ({ url }: { url?: string }) => ({
        id: nextTabId++,
        url,
      })),
      query: vi.fn(
        async (_query: chrome.tabs.QueryInfo) => [] as chrome.tabs.Tab[],
      ),
    },
    scripting: {
      executeScript: vi.fn(
        async (
          _injection: chrome.scripting.ScriptInjection<unknown[], unknown>,
        ): Promise<{ result?: unknown }[]> => [],
      ),
      registerContentScripts: vi.fn(
        async (_scripts: chrome.scripting.RegisteredContentScript[]) => {},
      ),
      updateContentScripts: vi.fn(
        async (_scripts: chrome.scripting.RegisteredContentScript[]) => {},
      ),
      unregisterContentScripts: vi.fn(
        async (_filter?: chrome.scripting.ContentScriptFilter) => {},
      ),
      getRegisteredContentScripts: vi.fn(
        async (_filter?: chrome.scripting.ContentScriptFilter) =>
          [] as chrome.scripting.RegisteredContentScript[],
      ),
    },
    sidePanel: {
      setPanelBehavior: vi.fn(
        async (_behavior: chrome.sidePanel.PanelBehavior) => {},
      ),
    },
    devtools: {
      panels: {
        /** Every panel created, so a test can dispatch its onShown. */
        created,
        create: vi.fn(
          (
            _title: string,
            _iconPath: string,
            _pagePath: string,
            callback?: (panel: FakePanel) => void,
          ) => {
            const panel: FakePanel = {
              onShown: fakeEvent<[window: Window]>(),
              onHidden: fakeEvent<[]>(),
            };
            created.push(panel);
            callback?.(panel);
          },
        ),
      },
      network: {
        onRequestFinished:
          fakeEvent<[request: chrome.devtools.network.Request]>(),
      },
    },
  };
}

export type FakeChrome = ReturnType<typeof createFakeChrome>;

/** Installs a fresh fake as the global `chrome`; vi.unstubAllGlobals() removes it. */
export function installFakeChrome(): FakeChrome {
  const fake = createFakeChrome();
  vi.stubGlobal("chrome", fake);
  return fake;
}
