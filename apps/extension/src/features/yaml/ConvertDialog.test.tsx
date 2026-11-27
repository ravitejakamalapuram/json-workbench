// @vitest-environment happy-dom
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveFile } from "../../app/export/save-file";
import type { DocumentModel } from "../../platform/types";
import type { Handlers } from "../../platform/workers/protocol";
import { fakeWorker } from "../../testing/fake-worker";
import {
  createTestStore,
  openText,
  renderWithStore,
} from "../../testing/render";
import { parseYaml } from "./codec";
import { ConvertDialog } from "./ConvertDialog";
import { DESCRIPTIONS } from "./names";
import { spawnYamlWorker } from "./spawn";
import { yamlHandlers, type YamlOps } from "./yaml-ops";

// No global Worker in tests: the dialog's worker runs the real handlers in-process.
vi.mock("./spawn", () => ({ spawnYamlWorker: vi.fn() }));
// Saving is the browser's download; the test reads what would be saved.
vi.mock("../../app/export/save-file", async (original) => ({
  ...(await original<typeof import("../../app/export/save-file")>()),
  saveFile: vi.fn(),
}));

let workers: Worker[] = [];
function useHandlers(handlers: Handlers<YamlOps>) {
  vi.mocked(spawnYamlWorker).mockImplementation(() => {
    const worker = fakeWorker(handlers);
    vi.spyOn(worker, "terminate");
    workers.push(worker);
    return worker;
  });
}

beforeEach(() => {
  workers = [];
  vi.mocked(spawnYamlWorker).mockReset();
  useHandlers(yamlHandlers);
});
afterEach(() => {
  cleanup();
  vi.mocked(saveFile).mockReset();
});

async function setup(text: string, name = "people.json", limitMb = 64) {
  const store = createTestStore();
  const doc = await openText(store, text, { name });
  return show(doc, limitMb, store);
}

function show(doc: DocumentModel, limitMb = 64, store = createTestStore()) {
  const onClose = vi.fn();
  const user = userEvent.setup();
  renderWithStore(
    <ConvertDialog doc={doc} limitMb={limitMb} onClose={onClose} />,
    { store },
  );
  return { onClose, user };
}

async function saved(): Promise<{ name: string; text: string }> {
  await waitFor(() => expect(saveFile).toHaveBeenCalledOnce());
  const [blob, name] = vi.mocked(saveFile).mock.calls[0] ?? [];
  if (!blob || !name) throw new Error("nothing saved");
  return { name, text: await blob.text() };
}

describe("ConvertDialog", () => {
  it("says what will happen, with the caveat, before anything runs", async () => {
    await setup('{"a":1}');
    expect(
      screen.getByRole("dialog", { name: "Convert to YAML" }),
    ).toBeDefined();
    expect(screen.getByText(DESCRIPTIONS.toYaml)).toBeDefined();
    expect(DESCRIPTIONS.toYaml).toContain("Comments and anchors are not kept.");
    expect(spawnYamlWorker).not.toHaveBeenCalled();
  });

  it("converts in a disposable worker, saves <name>.yaml and closes", async () => {
    const { user, onClose } = await setup('[{"name":"Ada"},{"name":"Bruno"}]');
    await user.click(screen.getByRole("button", { name: "Convert" }));
    expect(await saved()).toEqual({
      name: "people.yaml",
      text: "- name: Ada\n- name: Bruno\n",
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(workers).toHaveLength(1);
    expect(workers[0]?.terminate).toHaveBeenCalled();
  });

  it("keeps big numbers digit for digit", async () => {
    const { user } = await setup('{"id":900719925474099312345,"price":1.10}');
    await user.click(screen.getByRole("button", { name: "Convert" }));
    expect((await saved()).text).toBe(
      "id: 900719925474099312345\nprice: 1.10\n",
    );
  });

  it("names a pasted document by its format", async () => {
    const { user } = await setup("[1]", "Pasted text");
    await user.click(screen.getByRole("button", { name: "Convert" }));
    expect((await saved()).name).toBe("Pasted text.yaml");
  });

  it("converts a JSONL document to a list of its records", async () => {
    const { user } = await setup('{"a":1}\n{"a":2}\n', "events.jsonl");
    await user.click(screen.getByRole("button", { name: "Convert" }));
    const { name, text } = await saved();
    expect(name).toBe("events.yaml");
    expect(parseYaml(text)).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("writes markup in keys and values as text and renders none of it", async () => {
    const key = "<img src=x onerror=alert(1)>";
    const { user } = await setup(`{"${key}":"<script>alert(1)</script>"}`);
    await user.click(screen.getByRole("button", { name: "Convert" }));
    expect(parseYaml((await saved()).text)).toEqual({
      [key]: "<script>alert(1)</script>",
    });
    expect(document.querySelector("img, script")).toBeNull();
  });

  it("shows progress and a Cancel that ends the worker without saving", async () => {
    useHandlers({
      toYaml: (_args, { progress }) => {
        progress("reading");
        return new Promise(() => undefined);
      },
    });
    const { user, onClose } = await setup("[1]");
    await user.click(screen.getByRole("button", { name: "Convert" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "Reading the document…",
      ),
    );
    expect(screen.getByRole("progressbar")).toBeDefined();
    expect(
      screen
        .getByRole("button", { name: "Converting…" })
        .hasAttribute("disabled"),
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(workers[0]?.terminate).toHaveBeenCalled();
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("closing the dialog while it converts ends the worker too", async () => {
    useHandlers({ toYaml: () => new Promise(() => undefined) });
    const { user } = await setup("[1]");
    await user.click(screen.getByRole("button", { name: "Convert" }));
    await waitFor(() => expect(workers).toHaveLength(1));
    cleanup();
    expect(workers[0]?.terminate).toHaveBeenCalled();
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("says why a document over the limit was not converted and lets the user close", async () => {
    // 0.0001 MB is about 100 bytes, so the loader refuses this document.
    const { user, onClose } = await setup(
      `{"a":"${"x".repeat(300)}"}`,
      "big.json",
      0.0001,
    );
    await user.click(screen.getByRole("button", { name: "Convert" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/larger than/);
    expect(saveFile).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Convert" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("shows a worker failure as a sentence", async () => {
    useHandlers({
      toYaml: () => {
        throw new Error("This document is nested too deeply to write as YAML.");
      },
    });
    const { user } = await setup("[1]");
    await user.click(screen.getByRole("button", { name: "Convert" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "This document is nested too deeply to write as YAML.",
    );
  });
});
