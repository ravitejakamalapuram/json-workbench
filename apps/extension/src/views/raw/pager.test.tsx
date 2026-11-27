// @vitest-environment happy-dom
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionsFor, runAction } from "../../app/actions";
import { useGlobalShortcuts } from "../../app/shell/shortcuts";
import {
  LIMITS,
  type DocumentModel,
  type ParseIssue,
} from "../../platform/types";
import { changedBlob, GatedBlob } from "../../testing/blobs";
import { documentFixture, fakeIndex } from "../../testing/fixtures";
import { fakeWorker } from "../../testing/fake-worker";
import { useAppStoreApi } from "../../store";
import { createTestStore, renderWithStore } from "../../testing/render";
import { rawProblemDetails, rawView } from ".";
import type { Handlers } from "../../platform/workers/protocol";
import {
  createPagerHandlers,
  type PagerOps,
  type PagerOptions,
} from "./pager-ops";
import { spawnPagerWorker } from "./pager-spawn";
import { IDLE, rawState } from "./raw-state";

vi.mock("./pager-spawn", () => ({ spawnPagerWorker: vi.fn() }));

/** Small rows and chunks, so the tests cross every seam with a few lines. */
let options: PagerOptions = {};
beforeEach(() => {
  options = {};
  vi.mocked(spawnPagerWorker).mockReset();
  vi.mocked(spawnPagerWorker).mockImplementation(() =>
    fakeWorker(createPagerHandlers(options)),
  );
  rawState.setState(IDLE);
});
afterEach(cleanup);

const ready = {
  kind: "ready",
  index: fakeIndex(),
  summary: { records: 0, nodes: null },
} as const;

/** The document says it is over the limit; its Blob is as small as the test needs. */
function large(text: string, overrides: Partial<DocumentModel> = {}) {
  return documentFixture({
    name: "big.jsonl",
    bytes: LIMITS.rawEditChars + 1,
    source: new Blob([text]),
    status: ready,
    ...overrides,
  });
}

/** The shell's page-wide shortcuts, over Raw's actions. */
function Keys({ doc }: { readonly doc: DocumentModel }) {
  const store = useAppStoreApi();
  useGlobalShortcuts(rawView.actions ?? [], () => ({
    state: store.getState(),
    doc,
    node: undefined,
  }));
  return null;
}

/** What the shell shows for a document: the view, its status bar and the problem section. */
function show(doc: DocumentModel) {
  return renderWithStore(
    <Suspense fallback={null}>
      <Keys doc={doc} />
      <rawView.Component doc={doc} />
      <div data-testid="status-bar">
        {rawView.StatusBar && <rawView.StatusBar doc={doc} />}
      </div>
      <div data-testid="problem">
        <rawProblemDetails.Component doc={doc} />
      </div>
    </Suspense>,
  );
}

const lines = (count: number) =>
  Array.from({ length: count }, (_, at) => `{"n":${at + 1}}`).join("\n");

/** [number, text] of every row mounted. */
const mounted = () =>
  screen
    .getAllByTestId("pager-row")
    .map((row) => [
      row.querySelector(".raw-pager-number")?.textContent,
      row.querySelector(".raw-pager-text")?.textContent,
    ]);
const status = () => screen.getByTestId("status-bar").textContent;

describe("the pager", () => {
  it("shows a document over the limit as numbered lines, without an editor", async () => {
    show(large(lines(3)));
    await screen.findByText('{"n":1}');
    expect(mounted()).toEqual([
      ["1", '{"n":1}'],
      ["2", '{"n":2}'],
      ["3", '{"n":3}'],
    ]);
    expect(document.querySelector(".cm-editor")).toBeNull();
    expect(screen.getByRole("list", { name: "Document text" })).toBeDefined();
  });

  it("is read only, says so, and reports the line it is on", async () => {
    show(large(lines(3)));
    await screen.findByText('{"n":1}');
    await waitFor(() =>
      expect(status()).toBe(
        "Ln 1Read only: files over 2 MB open for readingGo to line",
      ),
    );
  });

  it("makes the gutter as wide as the last line number needs, for every row alike", async () => {
    show(large(lines(12345)));
    await screen.findByText('{"n":1}');
    await waitFor(() =>
      expect(
        screen.getByTestId("raw-pager").style.getPropertyValue("--digits"),
      ).toBe("5"),
    );
  });

  it("shows markup in the document as text", async () => {
    const markup = "<img src=x onerror=alert(1)>";
    show(large(`"${markup}"`));
    await screen.findByText(`"${markup}"`);
    expect(document.querySelector("img")).toBeNull();
  });

  it("numbers a long line once and its pieces not at all", async () => {
    options = { rowBytes: 10 };
    show(large(`${"0123456789".repeat(3)}\nshort`));
    await screen.findByText("short");
    expect(mounted()).toEqual([
      ["1", "0123456789"],
      ["", "0123456789"],
      ["", "0123456789"],
      ["2", "short"],
    ]);
    const user = userEvent.setup();
    await user.click(screen.getAllByTestId("pager-row")[1] as HTMLElement);
    expect(status()).toContain("Ln 1 (continued)");
  });

  it("moves the active row with the arrow keys and reports its line", async () => {
    const user = userEvent.setup();
    show(large(lines(100)));
    await screen.findByText('{"n":1}');
    await user.click(screen.getAllByTestId("pager-row")[0] as HTMLElement);
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(status()).toContain("Ln 3");
    await user.keyboard("{ArrowUp}");
    expect(status()).toContain("Ln 2");
    expect(document.activeElement?.getAttribute("data-row")).toBe("1");
  });

  it("goes to the end and back to the start of a long document", async () => {
    const user = userEvent.setup();
    show(large(lines(5000)));
    await screen.findByText('{"n":1}');
    await user.click(screen.getAllByTestId("pager-row")[0] as HTMLElement);
    await user.keyboard("{End}");
    await screen.findByText('{"n":5000}');
    expect(status()).toContain("Ln 5,000");
    await user.keyboard("{Home}");
    await screen.findByText('{"n":1}');
    expect(status()).toContain("Ln 1");
  });

  /** happy-dom has no layout: runs `test` with a list that is ten rows high. */
  async function withTenRows(test: () => Promise<void>) {
    const height = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientHeight",
    );
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.getAttribute("role") === "list" ? 28 * 10 : 0;
      },
    });
    try {
      await test();
    } finally {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", height!);
    }
  }

  // The mounted range is shorter than a screen plus overscan at the start and
  // the end of the document, where one side is missing: not a measure of it.
  it("pages by the height of the list, also at the start", () =>
    withTenRows(async () => {
      const user = userEvent.setup();
      show(large(lines(500)));
      await screen.findByText('{"n":1}');
      await user.click(screen.getAllByTestId("pager-row")[0] as HTMLElement);
      await user.keyboard("{PageDown}");
      // One row of the screen before stays, as in the tree.
      expect(status()).toContain("Ln 10");
      await user.keyboard("{PageDown}");
      expect(status()).toContain("Ln 19");
    }));

  it("pages back by the same screenful", () =>
    withTenRows(async () => {
      const user = userEvent.setup();
      show(large(lines(500)));
      await screen.findByText('{"n":1}');
      await user.click(screen.getAllByTestId("pager-row")[0] as HTMLElement);
      await user.keyboard("{PageDown}{PageDown}{PageUp}");
      expect(status()).toContain("Ln 10");
      await user.keyboard("{PageUp}{PageUp}");
      expect(status()).toContain("Ln 1");
    }));

  it("has one row in the tab order", async () => {
    show(large(lines(100)));
    await screen.findByText('{"n":1}');
    const stops = screen
      .getAllByTestId("pager-row")
      .filter((row) => row.tabIndex === 0);
    expect(stops).toHaveLength(1);
  });

  it("only keeps the rows near the screen", async () => {
    const user = userEvent.setup();
    show(large(lines(5000)));
    await screen.findByText('{"n":1}');
    await user.click(screen.getAllByTestId("pager-row")[0] as HTMLElement);
    await user.keyboard("{End}");
    await screen.findByText('{"n":5000}');
    expect(screen.queryByText('{"n":1}')).toBeNull();
  });
});

describe("go to line", () => {
  async function open(user: ReturnType<typeof userEvent.setup>, count = 2000) {
    show(large(lines(count)));
    await screen.findByText('{"n":1}');
    await user.click(screen.getAllByTestId("pager-row")[0] as HTMLElement);
    await user.keyboard("{Control>}g{/Control}");
    return screen.findByRole("spinbutton", { name: "Go to line" });
  }

  it("opens a small input on Mod+G, which has the focus", async () => {
    const user = userEvent.setup();
    const input = await open(user);
    expect(document.activeElement).toBe(input);
    await waitFor(() =>
      expect(screen.getByText(/of 2,000 lines/)).toBeDefined(),
    );
  });

  it("opens the same input from a Go to line button in the status bar", async () => {
    const user = userEvent.setup();
    show(large(lines(2000)));
    await screen.findByText('{"n":1}');
    await user.click(
      within(screen.getByTestId("status-bar")).getByRole("button", {
        name: "Go to line",
      }),
    );
    expect(document.activeElement).toBe(
      await screen.findByRole("spinbutton", { name: "Go to line" }),
    );
  });

  it("is a registry action on Mod+G for the palette, available only while the pager shows", async () => {
    const goto = rawView.actions?.find((a) => a.id === "raw.goto-line");
    expect(goto).toMatchObject({ shortcut: "Mod+G", label: "Go to line" });
    expect(goto?.placement).toContain("palette");
    const ctx = { state: {} as never, doc: undefined, node: undefined };
    expect(goto?.when?.(ctx)).toBe(false);
    show(large(lines(20)));
    await screen.findByText('{"n":1}');
    expect(goto?.when?.(ctx)).toBe(true);
    await act(() => runAction(goto!, ctx));
    expect(await screen.findByRole("spinbutton", { name: "Go to line" })).toBe(
      document.activeElement,
    );
  });

  it("jumps to the line and puts the focus on its row", async () => {
    const user = userEvent.setup();
    await open(user);
    await user.keyboard("1500{Enter}");
    await screen.findByText('{"n":1500}');
    expect(status()).toContain("Ln 1,500");
    await waitFor(() =>
      expect(document.activeElement).toMatchObject({
        dataset: { testid: "pager-row" },
        textContent: expect.stringContaining('{"n":1500}'),
      }),
    );
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("says when the line is past the end, and stays where it was", async () => {
    const user = userEvent.setup();
    await open(user, 50);
    await user.keyboard("51{Enter}");
    expect((await screen.findByRole("status")).textContent).toBe(
      "The document has 50 lines.",
    );
    expect(status()).toContain("Ln 1");
  });

  it('says "1 line", not "1 lines", for a document that is one line', async () => {
    const user = userEvent.setup();
    await open(user, 1);
    await waitFor(() => expect(screen.getByText(/of 1 line$/)).toBeDefined());
    await user.keyboard("2{Enter}");
    expect((await screen.findByRole("status")).textContent).toBe(
      "The document has 1 line.",
    );
  });

  it("closes on Escape and gives the focus back to the rows", async () => {
    const user = userEvent.setup();
    await open(user);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(document.activeElement?.getAttribute("role")).toBe("listitem");
  });
});

describe("a document with a syntax error", () => {
  const text = `${lines(300)}\n{"n":301,}\n${lines(5)}`;
  const issue: ParseIssue = {
    message: "Expected double-quoted property name",
    byteOffset: text.indexOf("}\n", text.indexOf('{"n":301')),
    line: 301,
    column: 9,
  };
  const invalid = () =>
    large(text, { status: { kind: "invalid", issues: [issue] } });

  it("goes to the error from the problem block and marks its row", async () => {
    const user = userEvent.setup();
    show(invalid());
    await screen.findByText('{"n":1}');
    expect(screen.getByTestId("raw-error").textContent).toBe(
      "Line 301, column 9",
    );
    await user.click(screen.getByRole("button", { name: "Go to error" }));
    const row = await screen.findByText('{"n":301,}');
    expect(row.closest("[data-error]")).not.toBeNull();
    // Not by color or underline alone.
    expect(
      row.closest("[role=listitem]")?.getAttribute("aria-description"),
    ).toBe("Syntax error");
    expect(status()).toContain("Ln 301");
    // Keyboard focus follows the jump.
    await waitFor(() =>
      expect(document.activeElement).toMatchObject({
        dataset: { testid: "pager-row" },
        textContent: expect.stringContaining('{"n":301,}'),
      }),
    );
  });

  it("writes the position of a far error with separators, as the status bar does", async () => {
    show(
      large(text, {
        status: {
          kind: "invalid",
          issues: [{ ...issue, line: 1_012_058, column: 1_036 }],
        },
      }),
    );
    expect((await screen.findByTestId("raw-error")).textContent).toBe(
      "Line 1,012,058, column 1,036",
    );
  });

  it("offers no fix, because nothing here can edit the text", async () => {
    show(invalid());
    await screen.findByTestId("raw-error");
    expect(screen.queryByTestId("raw-apply-fix")).toBeNull();
  });

  it("has no Format, Minify or Apply fix to run", () => {
    const state = { view: "raw" } as never;
    const available = (doc: DocumentModel) =>
      actionsFor(
        rawView.actions ?? [],
        { state, doc, node: undefined },
        "toolbar",
      )
        .map((action) => action.id)
        .concat(
          actionsFor(
            rawView.actions ?? [],
            { state, doc, node: undefined },
            "palette",
          ).map((action) => action.id),
        );
    expect(available(documentFixture({ status: ready }))).toContain(
      "raw.format",
    );
    expect(available(large("[]"))).not.toContain("raw.format");
    expect(available(large("[]"))).not.toContain("raw.minify");
    expect(available(invalid())).not.toContain("raw.fix");
  });
});

describe("when it cannot show the document", () => {
  it("says why a refused document has nothing to show, and reads nothing", async () => {
    show(
      large("[]", {
        status: { kind: "failed", message: "This file is 2.0 GB." },
      }),
    );
    await screen.findByText("This file is 2.0 GB.");
    expect(spawnPagerWorker).not.toHaveBeenCalled();
  });

  it("says when the file changed on disk", async () => {
    show(large("[]", { source: changedBlob("[]") }));
    await screen.findByText("File changed on disk. Reopen it.");
  });

  it("ends the document when the file changed on disk, so the shell stops saying Valid", async () => {
    const doc = large("[]", { source: changedBlob("[]") });
    const store = createTestStore();
    store.setState({ docs: [doc], activeDocId: doc.id });
    renderWithStore(
      <Suspense fallback={null}>
        <rawView.Component doc={doc} />
      </Suspense>,
      { store },
    );
    await waitFor(() =>
      expect(store.getState().docs[0]?.status).toEqual({
        kind: "failed",
        message: "File changed on disk. Reopen it.",
      }),
    );
  });

  it("does not end the document for any other read failure", async () => {
    const doc = large("[]", { source: changedBlob("[]") });
    const store = createTestStore();
    store.setState({ docs: [doc], activeDocId: doc.id });
    const stopped: Handlers<PagerOps> = {
      ...createPagerHandlers(),
      open: () => Promise.reject(new Error("The worker stopped.")),
    };
    vi.mocked(spawnPagerWorker).mockImplementation(() => fakeWorker(stopped));
    renderWithStore(
      <Suspense fallback={null}>
        <rawView.Component doc={doc} />
      </Suspense>,
      { store },
    );
    await screen.findByText("The worker stopped.");
    expect(store.getState().docs[0]?.status.kind).toBe("ready");
  });

  it("ends its worker when the view goes away", async () => {
    const worker = fakeWorker(createPagerHandlers());
    const terminate = vi.spyOn(worker, "terminate");
    vi.mocked(spawnPagerWorker).mockImplementation(() => worker);
    const { unmount } = show(large(lines(3)));
    await screen.findByText('{"n":1}');
    unmount();
    expect(terminate).toHaveBeenCalled();
    expect(rawState.getState().controls).toBeNull();
  });
});

describe("while the scan is still counting rows", () => {
  // The scan reads 1 KiB at a time and stops at the gate, about 100 rows in.
  const gated = (text: string) => {
    options = { chunkBytes: 1024 };
    return new GatedBlob([text], 1024);
  };

  it("takes End on to the real last line once the scan has counted it", async () => {
    const user = userEvent.setup();
    const source = gated(lines(5000));
    show(large("", { source }));
    await screen.findByText('{"n":1}');
    await user.click(screen.getAllByTestId("pager-row")[0] as HTMLElement);
    await user.keyboard("{End}");
    expect(status()).not.toContain("Ln 5,000");
    source.release();
    await screen.findByText('{"n":5000}');
    await waitFor(() => expect(status()).toContain("Ln 5,000"));
    // The focus goes with it, to the row now in view.
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("data-row")).toBe("4999"),
    );
  });

  it("goes to an error the scan has not reached yet, once it has counted it", async () => {
    const user = userEvent.setup();
    const text = `${lines(300)}\n{"n":301,}\n${lines(5)}`;
    const source = gated(text);
    show(
      large("", {
        source,
        status: {
          kind: "invalid",
          issues: [
            {
              message: "Expected double-quoted property name",
              byteOffset: text.indexOf("}\n", text.indexOf('{"n":301')),
              line: 301,
              column: 9,
            },
          ],
        },
      }),
    );
    await screen.findByText('{"n":1}');
    await user.click(screen.getByRole("button", { name: "Go to error" }));
    expect(document.querySelector("[data-error]")).toBeNull();
    source.release();
    const row = await screen.findByText('{"n":301,}');
    expect(row.closest("[data-error]")).not.toBeNull();
    await waitFor(() => expect(status()).toContain("Ln 301"));
  });
});
