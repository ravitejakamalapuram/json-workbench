import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeChrome } from "../testing/fake-chrome";
import { HANDOFF_KEY, type Handoff } from "./contract";
import { clearStored, readStored, takeHandoff, writeStored } from "./storage";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("stored values in the extension", () => {
  it("round-trips a value through chrome.storage.local", async () => {
    const chrome = installFakeChrome();
    await writeStored("jwb.theme", "dark");
    expect(chrome.storage.local.data.get("jwb.theme")).toBe("dark");
    expect(await readStored("jwb.theme")).toBe("dark");
  });

  it("clears every key", async () => {
    const chrome = installFakeChrome();
    await writeStored("jwb.materializeLimitMb", 128);
    await clearStored();
    expect(chrome.storage.local.data.size).toBe(0);
    expect(await readStored("jwb.materializeLimitMb")).toBeUndefined();
  });
});

describe("a failing chrome.storage", () => {
  it("is logged and never thrown into the caller", async () => {
    const chrome = installFakeChrome();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(chrome.storage.local, "set").mockRejectedValue(new Error("quota"));
    vi.spyOn(chrome.storage.local, "get").mockRejectedValue(
      new Error("context invalidated"),
    );
    await expect(writeStored("jwb.theme", "dark")).resolves.toBeUndefined();
    await expect(readStored("jwb.theme")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe("stored values outside the extension", () => {
  it("keeps them in memory, so Vite dev and tests need no chrome", async () => {
    await writeStored("jwb.theme", "dark");
    expect(await readStored("jwb.theme")).toBe("dark");
    await clearStored();
    expect(await readStored("jwb.theme")).toBeUndefined();
  });
});

describe("takeHandoff", () => {
  const handoff: Handoff = {
    id: "h1",
    name: "api.example.com",
    text: "{}",
    expiresAt: 61_000,
  };

  function withHandoff(value: unknown) {
    vi.useFakeTimers({ now: 1_000 });
    const chrome = installFakeChrome();
    chrome.storage.session.data.set(HANDOFF_KEY, value);
    return chrome;
  }

  it("returns the slot once when the id matches and it has not expired", async () => {
    const chrome = withHandoff(handoff);
    expect(await takeHandoff("h1")).toEqual(handoff);
    expect(chrome.storage.session.data.has(HANDOFF_KEY)).toBe(false);
    expect(await takeHandoff("h1")).toBeNull();
  });

  it("refuses another id and still empties the slot", async () => {
    const chrome = withHandoff(handoff);
    expect(await takeHandoff("other")).toBeNull();
    expect(chrome.storage.session.data.has(HANDOFF_KEY)).toBe(false);
  });

  it("refuses an expired slot", async () => {
    withHandoff({ ...handoff, expiresAt: 999 });
    expect(await takeHandoff("h1")).toBeNull();
  });

  it("refuses a slot of another shape", async () => {
    withHandoff({ id: "h1", text: 42 });
    expect(await takeHandoff("h1")).toBeNull();
  });

  it("finds nothing outside the extension", async () => {
    expect(await takeHandoff("h1")).toBeNull();
  });
});
