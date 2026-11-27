// @vitest-environment happy-dom
import { act, cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentModel } from "../../platform/types";
import { fakeWorker } from "../../testing/fake-worker";
import { documentFixture, fakeIndex } from "../../testing/fixtures";
import {
  createTestStore,
  openText,
  renderWithStore,
} from "../../testing/render";
import { ExportDialog } from "./ExportDialog";
import { exportHandlers, type ExportOps } from "./export-ops";
import type { Handlers } from "../../platform/workers/protocol";
import { saveFile } from "./save-file";
import { spawnExportWorker } from "./spawn";

// No global Worker in tests: the dialog's worker runs the real handlers in-process.
vi.mock("./spawn", () => ({ spawnExportWorker: vi.fn() }));
// Saving is the browser's download; the test reads what would be saved.
vi.mock("./save-file", async (original) => ({
  ...(await original<typeof import("./save-file")>()),
  saveFile: vi.fn(),
}));

let workers: Worker[] = [];
function useHandlers(handlers: Handlers<ExportOps>) {
  vi.mocked(spawnExportWorker).mockImplementation(() => {
    const worker = fakeWorker(handlers);
    vi.spyOn(worker, "terminate");
    workers.push(worker);
    return worker;
  });
}

beforeEach(() => {
  workers = [];
  vi.mocked(spawnExportWorker).mockClear();
  useHandlers(exportHandlers);
});
afterEach(() => {
  cleanup();
  vi.mocked(saveFile).mockReset();
});

async function setup(text: string, name = "people.json") {
  const store = createTestStore();
  const doc = await openText(store, text, { name });
  return show(doc, store);
}

function show(doc: DocumentModel, store = createTestStore()) {
  const onClose = vi.fn();
  const user = userEvent.setup();
  renderWithStore(<ExportDialog doc={doc} onClose={onClose} />, { store });
  return { onClose, user, store };
}

async function saved(): Promise<{ name: string; text: string }> {
  await vi.waitFor(() => expect(saveFile).toHaveBeenCalledOnce());
  const [blob, name] = vi.mocked(saveFile).mock.calls[0] ?? [];
  if (!blob || !name) throw new Error("nothing saved");
  return { name, text: await blob.text() };
}

describe("ExportDialog", () => {
  it("converts the document in a disposable worker and saves the result", async () => {
    const { user, onClose } = await setup('[{"name":"Ada"},{"name":"Bruno"}]');
    await user.click(screen.getByRole("radio", { name: /CSV/ }));
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(await saved()).toEqual({
      name: "people.csv",
      text: "name\nAda\nBruno\n",
    });
    expect(onClose).toHaveBeenCalledOnce();
    expect(workers).toHaveLength(1);
    expect(workers[0]?.terminate).toHaveBeenCalled();
  });

  it("starts on JSON", async () => {
    const { user } = await setup('{"a":1}', "config.json");
    expect(
      screen.getByRole("radio", { name: /JSON/, checked: true }),
    ).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(await saved()).toEqual({
      name: "config.json",
      text: '{\n  "a": 1\n}',
    });
  });

  it("shows why a conversion failed and stays open", async () => {
    const { user, onClose } = await setup('{"a":1}');
    await user.click(screen.getByRole("radio", { name: /TSV/ }));
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "CSV and TSV need a list of objects at the top level.",
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("cancels a running conversion by ending its worker", async () => {
    useHandlers({
      ...exportHandlers,
      export: () => new Promise<Blob>(() => {}),
    });
    const { user } = await setup("[]");
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(
      screen
        .getByRole("button", { name: "Exporting…" })
        .hasAttribute("disabled"),
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(workers[0]?.terminate).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Export" })).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // Export and the formats are disabled while it runs; focus left on them
  // would fall to the inert page, where Escape no longer closes the dialog.
  it("keeps focus in the dialog while a conversion runs and after it ends", async () => {
    let fail: (error: Error) => void = () => {};
    useHandlers({
      ...exportHandlers,
      export: () => new Promise<Blob>((_, reject) => (fail = reject)),
    });
    const { user } = await setup("[]");
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
    act(() => fail(new Error("Out of memory.")));
    await screen.findByRole("alert");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Export" }),
    );
  });

  it("offers only the original file above the memory limit", async () => {
    const store = createTestStore();
    act(() => store.getState().setMaterializeLimitMb(32));
    const doc = documentFixture({
      name: "big.json",
      bytes: 40 * 1024 * 1024,
      source: new Blob(["[1]"]),
      status: {
        kind: "ready",
        index: fakeIndex(),
        summary: { records: 0, nodes: 2 },
      },
    });
    const { user } = show(doc, store);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText(/over the 32 MB limit/)).toBeDefined();
    await user.click(
      screen.getByRole("button", { name: "Save without converting" }),
    );
    expect(await saved()).toEqual({ name: "big.json", text: "[1]" });
    expect(spawnExportWorker).not.toHaveBeenCalled();
  });

  it("offers only the original file for a document with syntax errors", async () => {
    const { user } = await setup('{"a":}', "broken.json");
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText(/syntax errors/)).toBeDefined();
    await user.click(
      screen.getByRole("button", { name: "Save without converting" }),
    );
    expect(await saved()).toEqual({ name: "broken.json", text: '{"a":}' });
  });

  it("gives pasted text the extension of its format when saved as it is", async () => {
    const { user } = await setup('{"a":}', "Pasted text");
    await user.click(
      screen.getByRole("button", { name: "Save without converting" }),
    );
    expect((await saved()).name).toBe("Pasted text.json");
  });
});
