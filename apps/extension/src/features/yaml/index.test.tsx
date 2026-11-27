// @vitest-environment happy-dom
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionsFor, runAction } from "../../app/actions";
import { saveFile } from "../../app/export/save-file";
import type {
  Action,
  ActionContext,
  AppState,
  DocumentModel,
} from "../../platform/types";
import { fakeWorker } from "../../testing/fake-worker";
import { documentFixture, fakeIndex } from "../../testing/fixtures";
import { createTestStore, openText } from "../../testing/render";
import { yamlActions } from ".";
import { parseJsonValue, stringifyJsonValue } from "@json-workbench/core";
import { spawnYamlWorker } from "./spawn";
import { yamlHandlers } from "./yaml-ops";

vi.mock("./spawn", () => ({ spawnYamlWorker: vi.fn() }));
vi.mock("../../app/export/save-file", async (original) => ({
  ...(await original<typeof import("../../app/export/save-file")>()),
  saveFile: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(spawnYamlWorker).mockImplementation(() => fakeWorker(yamlHandlers));
});
afterEach(() => {
  cleanup();
  vi.mocked(saveFile).mockReset();
});

const MB = 1024 * 1024;
const ready = {
  kind: "ready",
  index: fakeIndex(),
  summary: { records: 1, nodes: 1 },
} as const;

function action(id: string): Action {
  const found = yamlActions.find((a) => a.id === id);
  if (!found) throw new Error(`no action ${id}`);
  return found;
}

function context(doc: DocumentModel | undefined, limitMb = 64): ActionContext {
  return {
    state: { materializeLimitMb: limitMb } as AppState,
    doc,
    node: undefined,
  };
}

const offered = (doc: DocumentModel | undefined, limitMb = 64) =>
  actionsFor(yamlActions, context(doc, limitMb), "palette").map((a) => a.id);

describe("yamlActions", () => {
  it("are plain, described, shortcut-free and offered in the palette and the toolbar", () => {
    expect(yamlActions.map((a) => a.label)).toEqual([
      "Convert to YAML",
      "Convert to JSON",
    ]);
    for (const a of yamlActions) {
      expect(a.id.startsWith("yaml.")).toBe(true);
      expect(a.shortcut).toBeUndefined();
      expect(a.placement).toEqual(["toolbar", "palette"]);
      expect(a.description).toMatch(/^[A-Z].*\.$/);
    }
    expect(yamlActions[0]?.description).toContain(
      "Comments and anchors are not kept.",
    );
  });

  describe("Convert to YAML", () => {
    it("is offered for a ready document that fits the memory limit", () => {
      const doc = documentFixture({ status: ready });
      expect(offered(doc)).toEqual(["yaml.to-yaml"]);
    });

    it("is not offered while loading, with errors, after a failure or with no document", () => {
      for (const status of [
        { kind: "loading" },
        {
          kind: "indexing",
          index: fakeIndex(),
          progress: { indexedBytes: 0, totalBytes: 1, records: 0 },
        },
        { kind: "invalid", issues: [] },
        { kind: "failed", message: "x" },
      ] as const)
        expect(offered(documentFixture({ status }))).toEqual([]);
      expect(offered(undefined)).toEqual([]);
    });

    it("is not offered above materializeLimitMb", () => {
      const source = new Blob(["{}"]);
      Object.defineProperty(source, "size", { value: 33 * MB });
      const doc = documentFixture({ status: ready, source });
      expect(offered(doc, 32)).toEqual([]);
      expect(offered(doc, 64)).toEqual(["yaml.to-yaml"]);
    });
  });

  describe("Convert to JSON", () => {
    it("is offered for a ready YAML document, which is already YAML", () => {
      const doc = documentFixture({ format: "yaml", status: ready });
      expect(offered(doc)).toEqual(["yaml.to-json"]);
    });

    it("is not offered for a JSON or JSONL document", () => {
      for (const format of ["json", "jsonl"] as const)
        expect(offered(documentFixture({ format, status: ready }))).toEqual([
          "yaml.to-yaml",
        ]);
    });

    it("is not offered for a YAML document that has not settled", () => {
      expect(
        offered(
          documentFixture({ format: "yaml", status: { kind: "loading" } }),
        ),
      ).toEqual([]);
    });
  });

  it("Convert to JSON opens the document's JSON as a new document from a real YAML file", async () => {
    const store = createTestStore();
    const yaml = await openText(
      store,
      "# comment\nname: Ada\nid: 12345678901234567890\nbase: &b {x: 1}\nuse: *b\n",
      { name: "config.yaml" },
    );
    expect(yaml.status.kind).toBe("ready");
    expect(yaml.format).toBe("yaml");
    store.getState().setMode("transform");

    await runAction(action("yaml.to-json"), {
      state: store.getState(),
      doc: yaml,
      node: undefined,
    });

    const state = store.getState();
    const opened = state.docs.find((d) => d.id === state.activeDocId);
    expect(opened).toMatchObject({
      name: "config.json",
      origin: "convert",
      format: "json",
    });
    expect(state.docs).toHaveLength(2);
    expect(state.mode).toBe("view");
    await waitFor(() =>
      expect(store.getState().docs[1]?.status.kind).toBe("ready"),
    );
    const text = await opened?.source.text();
    expect(text).toBe(await yaml.source.text());
    expect(text).toContain("12345678901234567890");
    // The new document is JSON text the index read, not a YAML parse.
    expect(text).toContain('"use": {\n    "x": 1\n  }');
  });

  it("Convert to YAML opens a dialog that saves <name>.yaml and goes away", async () => {
    const store = createTestStore();
    const doc = await openText(
      store,
      '{"name":"Ada","id":900719925474099312345}',
      {
        name: "orders.json",
      },
    );
    const before = document.body.children.length;

    await runAction(action("yaml.to-yaml"), {
      state: store.getState(),
      doc,
      node: undefined,
    });
    const dialog = await screen.findByRole("dialog", {
      name: "Convert to YAML",
    });
    expect(dialog.textContent).toContain("Comments and anchors are not kept.");

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Convert" }));
    await waitFor(() => expect(saveFile).toHaveBeenCalledOnce());
    const [blob, name] = vi.mocked(saveFile).mock.calls[0] ?? [];
    expect(name).toBe("orders.yaml");
    expect(await blob?.text()).toBe("name: Ada\nid: 900719925474099312345\n");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.body.children.length).toBe(before);
  });

  it("round-trips: a document converted to YAML and opened again holds the same data", async () => {
    const json =
      '{"a":[1,{"b":null}],"s":"x\\ny","n":1.10,"id":900719925474099312345}';
    const store = createTestStore();
    const doc = await openText(store, json, { name: "data.json" });
    await runAction(action("yaml.to-yaml"), {
      state: store.getState(),
      doc,
      node: undefined,
    });
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Convert" }));
    await waitFor(() => expect(saveFile).toHaveBeenCalledOnce());
    const [blob] = vi.mocked(saveFile).mock.calls[0] ?? [];
    const yaml = await openText(store, (await blob?.text()) ?? "", {
      name: "data.yaml",
    });
    expect(yaml.status.kind).toBe("ready");
    expect(await yaml.source.text()).toBe(
      stringifyJsonValue(parseJsonValue(json), true),
    );
  });
});
