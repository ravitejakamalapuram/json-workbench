// @vitest-environment happy-dom
import { undoDepth } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionForKey, actionsFor, runAction } from "../../app/actions";
import { ViewportHeightContext } from "../../app/ui/VirtualList";
import { LIMITS, type DocumentModel } from "../../platform/types";
import { AppStoreProvider, useAppStore } from "../../store";
import {
  documentFixture,
  fakeIndex,
  fakeOpenIndex,
} from "../../testing/fixtures";
import { fakeWorker } from "../../testing/fake-worker";
import {
  createTestStore,
  openText,
  renderWithStore,
} from "../../testing/render";
import { rawProblemDetails, rawView } from ".";
import { rawHandlers, type RawOps } from "./raw-ops";
import { IDLE, rawState } from "./raw-state";
import { DEBOUNCE_MS } from "./saver";
import { spawnRawWorker } from "./spawn";

vi.mock("./spawn", () => ({ spawnRawWorker: vi.fn() }));

beforeEach(() => {
  vi.mocked(spawnRawWorker).mockClear();
  vi.mocked(spawnRawWorker).mockImplementation(() => fakeWorker(rawHandlers));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** What the shell shows for the front document: the view, its status bar and the problem section. */
function Front() {
  const doc = useAppStore((state) =>
    state.docs.find((d) => d.id === state.activeDocId),
  );
  if (!doc) return null;
  return (
    <Suspense fallback={null}>
      <rawView.Component doc={doc} />
      <div data-testid="status-bar">
        {rawView.StatusBar && <rawView.StatusBar doc={doc} />}
      </div>
      <div data-testid="problem">
        <rawProblemDetails.Component doc={doc} />
      </div>
    </Suspense>
  );
}

const BROKEN = '{\n  "id": 1,\n  "name": "Ada",\n}\n';
const BIG = "900719925474099312345";

/** The text is read asynchronously; the editor exists once it has been. */
async function editorView() {
  const editor = await screen.findByTestId("raw-editor");
  return waitFor(() => {
    const dom = editor.querySelector<HTMLElement>(".cm-editor");
    const found = dom && EditorView.findFromDOM(dom);
    if (!found) throw new Error("no editor yet");
    return found;
  });
}

async function showRaw(text: string, name = "test.json") {
  const store = createTestStore();
  await openText(store, text, { name });
  const result = renderWithStore(<Front />, { store });
  return { ...result, store, view: await editorView() };
}

const front = (store: ReturnType<typeof createTestStore>): DocumentModel => {
  const { docs, activeDocId } = store.getState();
  const doc = docs.find((d) => d.id === activeDocId);
  if (!doc) throw new Error("no document");
  return doc;
};

const action = (id: string) => {
  const found = rawView.actions?.find((a) => a.id === id);
  if (!found) throw new Error(`no action ${id}`);
  return found;
};

const context = (store: ReturnType<typeof createTestStore>) => ({
  state: store.getState(),
  doc: front(store),
  node: undefined,
});

const text = (view: EditorView) => view.state.doc.toString();

describe("the editor", () => {
  it("shows the text and the digits of a big number as they are", async () => {
    const { view } = await showRaw(`{"id":${BIG}}`);
    expect(text(view)).toBe(`{"id":${BIG}}`);
    expect(screen.getByTestId("raw-editor").textContent).toContain(BIG);
  });

  it("renders markup in the document as text", async () => {
    const markup = "<img src=x onerror=alert(1)>";
    await showRaw(`{"k":"${markup}"}`);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByTestId("raw-editor").textContent).toContain(markup);
  });

  it("names the editor for assistive technology", async () => {
    await showRaw("[1]");
    expect(screen.getByRole("textbox", { name: "JSON text" })).toBeDefined();
  });

  it("is read-only for a YAML document and says so", async () => {
    const doc = documentFixture({
      format: "yaml",
      source: new Blob(['{"a":1}']),
    });
    renderWithStore(
      <Suspense fallback={null}>
        <rawView.Component doc={doc} />
        {rawView.StatusBar && <rawView.StatusBar doc={doc} />}
      </Suspense>,
    );
    await screen.findByText("Read only · converted from YAML");
    const dom = screen
      .getByTestId("raw-editor")
      .querySelector<HTMLElement>(".cm-editor");
    const view = dom && EditorView.findFromDOM(dom);
    expect(view?.state.readOnly).toBe(true);
  });

  it("keeps the editor a document is in when an edit takes its bytes past the limit", async () => {
    // The store counts UTF-16 units, the pager is chosen by bytes: a few
    // non-ASCII characters can pass one limit and not the other mid-edit.
    const doc = documentFixture({ source: new Blob(['{"a":1}']) });
    const { rerender, store } = renderWithStore(
      <Suspense fallback={null}>
        <rawView.Component doc={doc} />
      </Suspense>,
    );
    await screen.findByTestId("raw-editor");
    // Wrapped as renderWithStore wraps, or React would mount a new tree.
    rerender(
      <AppStoreProvider value={store}>
        <ViewportHeightContext.Provider value={560}>
          <Suspense fallback={null}>
            <rawView.Component
              doc={{ ...doc, bytes: LIMITS.rawEditChars + 1 }}
            />
          </Suspense>
        </ViewportHeightContext.Provider>
      </AppStoreProvider>,
    );
    // The pager is a lazy chunk: give it the time it would need to appear.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(screen.getByTestId("raw-editor")).toBeDefined();
    expect(screen.queryByTestId("raw-pager")).toBeNull();
  });

  it("gives a document over the limit the pager, and its failure the plain message", async () => {
    const doc = documentFixture({
      bytes: LIMITS.rawEditChars + 1,
      status: { kind: "failed", message: "Too large." },
    });
    renderWithStore(
      <Suspense fallback={null}>
        <rawView.Component doc={doc} />
      </Suspense>,
    );
    await screen.findByText("Too large.");
    expect(screen.queryByTestId("raw-editor")).toBeNull();
  });
});

describe("saving edits", () => {
  it("hands the text to the document 250 ms after the last keystroke", async () => {
    const { store, view } = await showRaw('{"a":1}');
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    view.dispatch({ changes: { from: 6, insert: ',"b":2' } });
    vi.advanceTimersByTime(249);
    expect(front(store).edited).toBe(false);
    vi.advanceTimersByTime(1);
    expect(front(store).edited).toBe(true);
    vi.useRealTimers();
    await expect(front(store).source.text()).resolves.toBe('{"a":1,"b":2}');
  });

  it("counts a burst of keystrokes as one edit", async () => {
    const { store, view } = await showRaw("[1]");
    const edit = vi.spyOn(store.getState(), "editDocument");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    for (const at of [1, 2, 3]) {
      view.dispatch({ changes: { from: at, insert: "1" } });
      vi.advanceTimersByTime(200);
    }
    expect(edit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(edit).toHaveBeenCalledTimes(1);
    expect(edit).toHaveBeenCalledWith(front(store).id, "[1111]");
  });

  it("hands over what was typed when the view is left", async () => {
    const { store, view, unmount } = await showRaw("[1]");
    view.dispatch({ changes: { from: 1, insert: "2," } });
    unmount();
    expect(front(store).edited).toBe(true);
    await expect(front(store).source.text()).resolves.toBe("[2,1]");
  });

  it("hands over what was typed the moment the editor loses focus", async () => {
    // A click on another view's tab blurs the editor first; the document must
    // hold the text by then, or the view that mounts reads a stale index.
    const { store, view } = await showRaw("[1]");
    view.dispatch({ changes: { from: 1, insert: "2," } });
    expect(front(store).edited).toBe(false);
    view.contentDOM.dispatchEvent(new FocusEvent("blur"));
    expect(front(store).edited).toBe(true);
    await expect(front(store).source.text()).resolves.toBe("[2,1]");
  });

  it("does not load its own edit back into the editor", async () => {
    const { store, view } = await showRaw("[1]");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    view.dispatch({ changes: { from: 1, insert: "2," } });
    view.dispatch({ selection: { anchor: 3 } });
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(front(store).status.kind).toBe("ready"));
    expect(text(view)).toBe("[2,1]");
    expect(view.state.selection.main.head).toBe(3);
  });

  it("does not save text that came from the document back to it", async () => {
    const { store, view } = await showRaw("[1]");
    const edit = vi.spyOn(store.getState(), "editDocument");
    // Another part of the app replaces the document's text under the editor.
    act(() => store.getState().editDocument(front(store).id, "[2]"));
    await waitFor(() => expect(text(view)).toBe("[2]"));
    await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS + 50));
    expect(edit).toHaveBeenCalledTimes(1);
  });

  it("refuses an edit past the size limit and says so", async () => {
    const { view } = await showRaw("[1]");
    view.dispatch({
      changes: { from: 1, insert: "1".repeat(LIMITS.rawEditChars) },
    });
    expect(text(view)).toBe("[1]");
    expect((await screen.findByRole("status")).textContent).toBe(
      "Raw edits stop at 2 MB. That change was not applied.",
    );
  });
});

describe("the error", () => {
  it("is underlined and described: where, why, and the repair", async () => {
    const { view } = await showRaw(BROKEN);
    const where = await screen.findByTestId("raw-error");
    expect(where.textContent).toBe("Line 4, column 1");
    expect(screen.getByTestId("problem").textContent).toContain(
      "Expected object property name.",
    );
    const underline = screen
      .getByTestId("raw-editor")
      .querySelector(".raw-error-token");
    expect(underline?.textContent).toBe("}");
    expect(
      screen.getByTestId("raw-editor").querySelector(".raw-error-line"),
    ).not.toBeNull();
    expect((await screen.findByTestId("raw-apply-fix")).textContent).toBe(
      "Remove trailing comma",
    );
    expect(text(view)).toBe(BROKEN);
  });

  it("shows nothing for a valid document", async () => {
    await showRaw('{"a":1}');
    expect(screen.queryByTestId("raw-error")).toBeNull();
    expect(screen.getByTestId("problem").textContent).toBe("");
  });

  it("names a second place the same mistake occurs", async () => {
    await showRaw('{\n  "a": [1,],\n  "b": 2,\n}');
    await screen.findByTestId("raw-apply-fix");
    expect(screen.getByTestId("problem").textContent).toContain(
      "Line 3 also has a trailing comma.",
    );
  });

  it("is repaired by the fix button: the text, then the status", async () => {
    const user = userEvent.setup();
    const { store, view } = await showRaw(BROKEN);
    await user.click(await screen.findByTestId("raw-apply-fix"));
    expect(text(view)).toBe('{\n  "id": 1,\n  "name": "Ada"\n}\n');
    await waitFor(() => expect(front(store).status.kind).toBe("ready"));
    await waitFor(() => expect(screen.queryByTestId("raw-error")).toBeNull());
    expect(
      screen.getByTestId("raw-editor").querySelector(".raw-error-token"),
    ).toBeNull();
  });

  it("is repaired by Mod+.", async () => {
    const { store, view } = await showRaw(BROKEN);
    await screen.findByTestId("raw-apply-fix");
    const press = new KeyboardEvent("keydown", {
      key: ".",
      code: "Period",
      ctrlKey: true,
    });
    const fix = actionForKey(
      rawView.actions ?? [],
      press,
      context(store),
      false,
    );
    expect(fix?.id).toBe("raw.fix");
    await act(async () => {
      await runAction(action("raw.fix"), context(store));
    });
    expect(text(view)).toBe('{\n  "id": 1,\n  "name": "Ada"\n}\n');
    await waitFor(() => expect(front(store).status.kind).toBe("ready"));
  });

  it("offers no fix while the text is being edited, and none that is stale", async () => {
    const { view } = await showRaw(BROKEN);
    await screen.findByTestId("raw-apply-fix");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    act(() => view.dispatch({ changes: { from: 1, insert: " " } }));
    expect(screen.queryByTestId("raw-apply-fix")).toBeNull();
    // Still told where the error was, until the new text has been parsed.
    expect(screen.getByTestId("raw-error")).toBeDefined();
  });

  it("drops a fix that arrives after the text it was computed for has changed", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.mocked(spawnRawWorker).mockImplementation(() =>
      fakeWorker<RawOps>({
        ...rawHandlers,
        fixes: async (input, context) => {
          await gate;
          return rawHandlers.fixes(input, context);
        },
      }),
    );
    const { view } = await showRaw(BROKEN);
    await screen.findByTestId("raw-error");
    // Typed while the worker was still looking: its answer fits the old text.
    act(() => view.dispatch({ changes: { from: 1, insert: " " } }));
    release();
    await act(async () => {
      await gate;
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.queryByTestId("raw-apply-fix")).toBeNull();
  });

  it("leaves a late verdict alone while the editor holds text the document has not seen", async () => {
    const engine = fakeOpenIndex();
    const store = createTestStore({ openIndex: engine.openIndex });
    store.getState().openDocument({
      name: "test.json",
      origin: "paste",
      source: new Blob(["[1,]"]),
      format: "json",
    });
    renderWithStore(<Front />, { store });
    const view = await editorView();
    act(() => view.dispatch({ changes: { from: 1, insert: " " } }));
    const [open] = engine.opens;
    act(() =>
      open?.settle({
        kind: "invalid",
        issues: [
          { message: "Unexpected ]", byteOffset: 3, line: 1, column: 4 },
        ],
      }),
    );
    await waitFor(() => expect(front(store).status.kind).toBe("invalid"));
    // The verdict is about "[1,]", not about "[ 1,]" as it now stands.
    expect(
      screen.getByTestId("raw-editor").querySelector(".raw-error-token"),
    ).toBeNull();
    expect(spawnRawWorker).not.toHaveBeenCalled();
  });

  it("offers a fix only for the error it was computed for", async () => {
    const issue = {
      message: "Unexpected ]",
      byteOffset: 3,
      line: 1,
      column: 4,
    };
    const fix = { label: "Remove trailing comma", changes: [] };
    const problemFor = (first: typeof issue) => (
      <Suspense fallback={null}>
        <rawProblemDetails.Component
          doc={documentFixture({
            status: { kind: "invalid", issues: [first] },
          })}
        />
      </Suspense>
    );
    act(() => rawState.setState({ problem: { issue, fixes: [fix] } }));
    const first = renderWithStore(problemFor(issue));
    expect((await screen.findByTestId("raw-apply-fix")).textContent).toBe(
      fix.label,
    );
    first.unmount();
    // The same position in a new verdict is still another error.
    renderWithStore(problemFor({ ...issue }));
    await screen.findByTestId("raw-error");
    expect(screen.queryByTestId("raw-apply-fix")).toBeNull();
    act(() => rawState.setState(IDLE));
  });

  it("marks the error but computes no fix when the editor is read-only", async () => {
    // Fixes repair JSON text; applying one would edit a document Raw shows read-only.
    const doc = documentFixture({
      format: "yaml",
      source: new Blob(['{"a":1,}']),
      status: {
        kind: "invalid",
        issues: [
          {
            message: "Expected object property name",
            byteOffset: 7,
            line: 1,
            column: 8,
          },
        ],
      },
    });
    renderWithStore(
      <Suspense fallback={null}>
        <rawView.Component doc={doc} />
        <rawProblemDetails.Component doc={doc} />
      </Suspense>,
    );
    const editor = await screen.findByTestId("raw-editor");
    await waitFor(() =>
      expect(editor.querySelector(".raw-error-token")).not.toBeNull(),
    );
    expect(screen.getByTestId("raw-error").textContent).toBe(
      "Line 1, column 8",
    );
    expect(screen.queryByTestId("raw-apply-fix")).toBeNull();
    expect(spawnRawWorker).not.toHaveBeenCalled();
  });

  it("is reached by Go to error, which the status bar then confirms", async () => {
    const user = userEvent.setup();
    const { view } = await showRaw(BROKEN);
    await screen.findByTestId("raw-error");
    await user.click(screen.getByRole("button", { name: "Go to error" }));
    expect(view.state.selection.main.head).toBe(BROKEN.indexOf("}"));
    expect(screen.getByTestId("status-bar").textContent).toBe("Ln 4, Col 1");
  });
});

describe("the problem block in the side panel", () => {
  // Below 640 px the shell shows the details over the editor (data-overlay),
  // so a jump or a fix made behind them cannot be seen.
  function InOverlay() {
    const doc = useAppStore((state) =>
      state.docs.find((d) => d.id === state.activeDocId),
    );
    if (!doc) return null;
    return (
      <Suspense fallback={null}>
        <rawView.Component doc={doc} />
        <aside data-overlay>
          <rawProblemDetails.Component doc={doc} />
        </aside>
      </Suspense>
    );
  }

  async function showOverlay() {
    const store = createTestStore();
    await openText(store, BROKEN, { name: "test.json" });
    renderWithStore(<InOverlay />, { store });
    await editorView();
    expect(store.getState().detailsOpen).toBe(true);
    return { store, user: userEvent.setup() };
  }

  it("closes after Go to error, and the editor holds focus", async () => {
    const { store, user } = await showOverlay();
    await user.click(
      await screen.findByRole("button", { name: "Go to error" }),
    );
    expect(store.getState().detailsOpen).toBe(false);
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "JSON text",
    );
  });

  it("closes after a fix, so the repaired text is what shows", async () => {
    const { store, user } = await showOverlay();
    await user.click(await screen.findByTestId("raw-apply-fix"));
    expect(store.getState().detailsOpen).toBe(false);
  });

  it("stays open where it sits beside the editor", async () => {
    const store = createTestStore();
    await openText(store, BROKEN, { name: "test.json" });
    renderWithStore(<Front />, { store });
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("raw-apply-fix"));
    expect(store.getState().detailsOpen).toBe(true);
  });
});

describe("scrolling to a spot", () => {
  /** What the dispatches asked of the scroll: CodeMirror keeps it in an effect. */
  function scrolls(view: EditorView) {
    const dispatch = vi.spyOn(view, "dispatch");
    return () =>
      dispatch.mock.calls
        .flatMap(([spec]) => (spec && "effects" in spec ? [spec.effects] : []))
        .flat()
        .flatMap((effect) =>
          // Other effects carry other values, null among them.
          effect && effect.value && typeof effect.value === "object"
            ? [effect.value as { y?: string; yMargin?: number }]
            : [],
        );
  }

  it("centers the error for Go to error, not on the edge of the editor", async () => {
    const user = userEvent.setup();
    const { view } = await showRaw(BROKEN);
    const asked = scrolls(view);
    await screen.findByTestId("raw-error");
    await user.click(screen.getByRole("button", { name: "Go to error" }));
    expect(asked()).toContainEqual(expect.objectContaining({ y: "center" }));
  });

  it("keeps rows of context around the spot a fix puts the cursor on", async () => {
    const user = userEvent.setup();
    const { view } = await showRaw(BROKEN);
    const asked = scrolls(view);
    await user.click(await screen.findByTestId("raw-apply-fix"));
    const [first] = asked().filter((target) => target.y === "nearest");
    expect(first?.yMargin).toBeGreaterThan(28);
  });
});

describe("the cursor", () => {
  it("is reported as Ln and Col, columns counted in UTF-16 units", async () => {
    const { view } = await showRaw('{\n  "😀": 1\n}');
    expect(screen.getByTestId("status-bar").textContent).toBe("Ln 1, Col 1");
    act(() => view.dispatch({ selection: { anchor: 4 } }));
    expect(screen.getByTestId("status-bar").textContent).toBe("Ln 2, Col 3");
    act(() => view.dispatch({ selection: { anchor: 7 } }));
    // Two spaces, a quote and a two-unit emoji come before: column 6, not 5.
    expect(screen.getByTestId("status-bar").textContent).toBe("Ln 2, Col 6");
  });
});

describe("format and minify", () => {
  it("indents the text, keeps big numbers and lets the document follow", async () => {
    const { store, view } = await showRaw(`{"id":${BIG},"a":[1,2]}`);
    await act(async () => {
      await runAction(action("raw.format"), context(store));
    });
    await waitFor(() =>
      expect(text(view)).toBe(
        `{\n  "id": ${BIG},\n  "a": [\n    1,\n    2\n  ]\n}`,
      ),
    );
    await waitFor(() => expect(front(store).edited).toBe(true));
    await waitFor(() => expect(front(store).status.kind).toBe("ready"));
  });

  it("keeps the editor focused and the rewrite undoable, whoever asked for it", async () => {
    // The toolbar button that was pressed goes away while the document
    // re-indexes, so focus would fall to the page and Ctrl+Z would do nothing.
    const { store, view } = await showRaw('{"a":1}');
    expect(document.activeElement).not.toBe(view.contentDOM);
    await act(async () => {
      await runAction(action("raw.format"), context(store));
    });
    await waitFor(() => expect(text(view)).toBe('{\n  "a": 1\n}'));
    expect(document.activeElement).toBe(view.contentDOM);
    // One undo step, which is the whole rewrite.
    expect(undoDepth(view.state)).toBe(1);
  });

  it("does not overwrite what was typed while the worker was rewriting", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.mocked(spawnRawWorker).mockImplementation(() =>
      fakeWorker<RawOps>({
        ...rawHandlers,
        format: async (input, context) => {
          await gate;
          return rawHandlers.format(input, context);
        },
      }),
    );
    const { store, view } = await showRaw('{"a":1}');
    const formatting = runAction(action("raw.format"), context(store));
    act(() => view.dispatch({ changes: { from: 1, insert: " " } }));
    release();
    await act(async () => {
      await formatting;
    });
    expect(text(view)).toBe('{ "a":1}');
  });

  it("puts it back on one line", async () => {
    const { store, view } = await showRaw('{\n  "a": [\n    1\n  ]\n}');
    await act(async () => {
      await runAction(action("raw.minify"), context(store));
    });
    await waitFor(() => expect(text(view)).toBe('{"a":[1]}'));
  });

  it("says why when the text in the editor does not parse", async () => {
    const { store, view } = await showRaw('{"a":1}');
    view.dispatch({ changes: { from: 6, insert: ",," } });
    await act(async () => {
      await runAction(action("raw.format"), context(store));
    });
    expect((await screen.findByRole("status")).textContent).toMatch(
      /^Could not rewrite: /,
    );
    expect(text(view)).toBe('{"a":1,,}');
    // The next edit is a new text, so the reason no longer applies.
    act(() => view.dispatch({ changes: { from: 1, insert: " " } }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("is on the toolbar the moment Raw is the view, and only then", async () => {
    // The shell lists toolbar actions while it renders, before the lazy view
    // has mounted, so availability cannot depend on the view having bound them.
    const store = createTestStore();
    await openText(store, '{"a":1}');
    const toolbar = () =>
      actionsFor(rawView.actions ?? [], context(store), "toolbar").map(
        (offered) => offered.id,
      );
    store.getState().setView("tree");
    expect(toolbar()).toEqual([]);
    store.getState().setView("raw");
    expect(toolbar()).toEqual(["raw.format", "raw.minify"]);
  });

  it("stays on the toolbar while an edited valid document is indexed again", async () => {
    // Each edit puts the document back to "indexing" for a moment. Dropping
    // the buttons for it moves the rest of the toolbar twice per pause.
    const { store } = await showRaw('{"a":1}');
    store.getState().setView("raw");
    const toolbar = () =>
      actionsFor(rawView.actions ?? [], context(store), "toolbar").map(
        (offered) => offered.id,
      );
    await waitFor(() =>
      expect(rawState.getState().validDoc).toBe(front(store).id),
    );
    act(() => store.getState().editDocument(front(store).id, '{"a":2}'));
    expect(front(store).status.kind).toBe("indexing");
    expect(toolbar()).toEqual(["raw.format", "raw.minify"]);
  });

  it("stays off the toolbar while an edited invalid document is indexed again", async () => {
    const { store } = await showRaw(BROKEN);
    store.getState().setView("raw");
    await screen.findByTestId("raw-error");
    act(() => store.getState().editDocument(front(store).id, `${BROKEN} `));
    expect(front(store).status.kind).toBe("indexing");
    expect(
      actionsFor(rawView.actions ?? [], context(store), "toolbar"),
    ).toEqual([]);
  });

  it("does not lend one document's verdict to another that is being indexed", async () => {
    const { store } = await showRaw('{"a":1}');
    store.getState().setView("raw");
    await waitFor(() =>
      expect(rawState.getState().validDoc).toBe(front(store).id),
    );
    const other = documentFixture({
      id: "other",
      status: {
        kind: "indexing",
        index: fakeIndex(),
        progress: { indexedBytes: 0, totalBytes: 2, records: 0 },
      },
    });
    expect(
      actionsFor(
        rawView.actions ?? [],
        { ...context(store), doc: other },
        "toolbar",
      ),
    ).toEqual([]);
  });

  it("is offered for a valid JSON document only", async () => {
    const { store } = await showRaw('{"a":1}');
    store.getState().setView("raw");
    const ready = context(store);
    expect(action("raw.format").when?.(ready)).toBe(true);
    expect(action("raw.fix").when?.(ready)).toBe(false);
    const invalid = { ...ready, doc: documentFixture() };
    expect(action("raw.format").when?.(invalid)).toBe(false);
    const jsonl = { ...ready, doc: { ...ready.doc, format: "jsonl" as const } };
    expect(action("raw.minify").when?.(jsonl)).toBe(false);
  });

  it("binds Mod+Shift+F to Format, in Raw only", async () => {
    const { store } = await showRaw('{"a":1}');
    const press = new KeyboardEvent("keydown", {
      key: "F",
      code: "KeyF",
      ctrlKey: true,
      shiftKey: true,
    });
    const pressed = () =>
      actionForKey(rawView.actions ?? [], press, context(store), false)?.id;
    store.getState().setView("tree");
    expect(pressed()).toBeUndefined();
    store.getState().setView("raw");
    expect(pressed()).toBe("raw.format");
  });
});

describe("dropping a file", () => {
  /** A drop as the browser sends it, with the dataTransfer happy-dom lacks. */
  function drop(types: string[]) {
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { types, files: [], getData: () => "inserted" },
    });
    return event;
  }

  it("is left to the page: the editor ignores it and the event bubbles", async () => {
    const { view, container } = await showRaw("[1]");
    const heard = vi.fn();
    container.addEventListener("drop", heard);
    const event = drop(["Files"]);
    view.contentDOM.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(text(view)).toBe("[1]");
  });
});

describe("view and section contracts", () => {
  it("supports every status, so the shell always has a view to fall back to", () => {
    const statuses: DocumentModel["status"][] = [
      { kind: "loading" },
      { kind: "invalid", issues: [] },
      { kind: "failed", message: "x" },
    ];
    for (const status of statuses)
      expect(rawView.supports(documentFixture({ status }))).toBe(true);
  });

  it("puts the problem section in Raw only", () => {
    expect(rawProblemDetails.views).toEqual(["raw"]);
    expect(rawProblemDetails.title).toBe("Problem");
  });
});
