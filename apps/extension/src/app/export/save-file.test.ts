// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportName, saveFile } from "./save-file";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("exportName", () => {
  it("swaps a data extension for the export format's", () => {
    expect(exportName("orders.json", "csv")).toBe("orders.csv");
    expect(exportName("events.ndjson", "jsonl")).toBe("events.jsonl");
    expect(exportName("config.YAML", "json")).toBe("config.json");
    expect(exportName("Pasted text", "tsv")).toBe("Pasted text.tsv");
    expect(exportName("v1.2 report.json", "ndjson")).toBe("v1.2 report.ndjson");
  });
});

describe("saveFile", () => {
  it("downloads the Blob under the name and frees its URL afterwards", () => {
    vi.useFakeTimers();
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const clicks: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push({ href: this.href, download: this.download });
    });
    const blob = new Blob(["[]"]);
    saveFile(blob, "orders.csv");
    expect(create).toHaveBeenCalledWith(blob);
    expect(clicks).toEqual([{ href: "blob:x", download: "orders.csv" }]);
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:x");
  });
});
