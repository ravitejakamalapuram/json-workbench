import type { PipelineStepDefinition } from "@json-workbench/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppStore } from ".";
import { readStored, writeStored } from "../platform/storage";
import { LIMITS } from "../platform/types";
import { installFakeChrome, type FakeChrome } from "../testing/fake-chrome";
import { loadSettings } from "./settings";

let chrome: FakeChrome;
beforeEach(() => {
  chrome = installFakeChrome();
});
afterEach(() => vi.unstubAllGlobals());

const store = () => createAppStore({ surface: "panel" });
const recent = (name: string, openedAt = 0) => ({ name, bytes: 10, openedAt });

describe("settings slice", () => {
  it("starts light, at 64 MB, with no recents", () => {
    expect(store().getState()).toMatchObject({
      theme: "light",
      materializeLimitMb: 64,
      recents: [],
    });
  });

  it("persists the theme and the materialize limit", async () => {
    const app = store();
    app.getState().setTheme("dark");
    app.getState().setMaterializeLimitMb(128);
    expect(app.getState()).toMatchObject({
      theme: "dark",
      materializeLimitMb: 128,
    });
    await vi.waitFor(async () => {
      expect(await readStored("jwb.theme")).toBe("dark");
      expect(await readStored("jwb.materializeLimitMb")).toBe(128);
    });
  });

  it("keeps the newest recents first, once per name, at most LIMITS.recents", async () => {
    const app = store();
    for (let i = 0; i < LIMITS.recents + 2; i++)
      app.getState().addRecent(recent(`file-${i}.json`, i));
    app.getState().addRecent(recent("file-5.json", 99));
    const names = app.getState().recents.map((file) => file.name);
    expect(names).toHaveLength(LIMITS.recents);
    expect(names[0]).toBe("file-5.json");
    expect(names.filter((name) => name === "file-5.json")).toHaveLength(1);
    await vi.waitFor(async () =>
      expect(await readStored("jwb.recents")).toEqual(app.getState().recents),
    );
    app.getState().clearRecents();
    expect(app.getState().recents).toEqual([]);
  });
});

describe("loadSettings", () => {
  it("restores what was stored", async () => {
    await writeStored("jwb.theme", "dark");
    await writeStored("jwb.materializeLimitMb", 32);
    await writeStored("jwb.recents", [recent("a.json")]);
    const app = store();
    await loadSettings(app);
    expect(app.getState()).toMatchObject({
      theme: "dark",
      materializeLimitMb: 32,
      recents: [recent("a.json")],
    });
  });

  it("ignores values of another shape, which an older version may have written", async () => {
    chrome.storage.local.data.set("jwb.theme", "sepia");
    chrome.storage.local.data.set("jwb.materializeLimitMb", 4096);
    chrome.storage.local.data.set("jwb.recents", [
      recent("ok.json"),
      { name: "no-size.json" },
    ]);
    const app = store();
    await loadSettings(app);
    expect(app.getState()).toMatchObject({
      theme: "light",
      materializeLimitMb: 64,
      recents: [recent("ok.json")],
    });
  });
});

describe("clearLocalData", () => {
  const step = (id: string): PipelineStepDefinition => ({
    id,
    type: "pick",
    enabled: true,
    config: {},
  });

  it("clears storage and resets every live slice that persists", async () => {
    const app = store();
    app.getState().setTheme("dark");
    app.getState().addRecent(recent("a.json"));
    app.getState().setTransformPipeline({ version: 1, steps: [step("old")] });
    await app.getState().clearLocalData();

    expect(chrome.storage.local.data.size).toBe(0);
    expect(app.getState()).toMatchObject({
      theme: "light",
      materializeLimitMb: 64,
      recents: [],
    });
    // Editing after the clear must start from the reset pipeline, so the
    // old one cannot be written back by the next save.
    const { transformPipeline, setTransformPipeline } = app.getState();
    setTransformPipeline({
      ...transformPipeline,
      steps: [...transformPipeline.steps, step("new")],
    });
    expect(app.getState().transformPipeline.steps.map((s) => s.id)).toEqual([
      "new",
    ]);
  });
});
