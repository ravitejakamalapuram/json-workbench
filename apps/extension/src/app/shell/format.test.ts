import { describe, expect, it } from "vitest";
import { documentFixture, fakeIndex } from "../../testing/fixtures";
import {
  dayLabel,
  formatBytes,
  pathLabel,
  selectionLabel,
  statusLabel,
} from "./format";

describe("formatBytes", () => {
  it("uses the largest unit that keeps a number of at least 1", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(48 * 1024)).toBe("48 KB");
    expect(formatBytes(1.25 * 1024 * 1024)).toBe("1.3 MB");
    expect(formatBytes(412 * 1024 * 1024)).toBe("412 MB");
    expect(formatBytes(1024 ** 3)).toBe("1 GB");
  });
});

describe("dayLabel", () => {
  const now = new Date(2026, 10, 27, 9, 0).getTime();
  it("says today, yesterday, or the date", () => {
    expect(dayLabel(new Date(2026, 10, 27, 0, 1).getTime(), now)).toBe("today");
    expect(dayLabel(new Date(2026, 10, 26, 23, 59).getTime(), now)).toBe(
      "yesterday",
    );
    expect(dayLabel(new Date(2026, 10, 2).getTime(), now)).toBe("Nov 2");
  });
});

describe("pathLabel", () => {
  it("shows a pointer as the JSONPath the details panel copies", () => {
    expect(pathLabel("")).toBe("$");
    expect(pathLabel("/items/0/price")).toBe("$.items[0].price");
    expect(pathLabel("/a~1b/first name")).toBe('$["a/b"]["first name"]');
  });
});

describe("selectionLabel", () => {
  it("shows each expanded string on the way to an embedded node", () => {
    expect(selectionLabel({ docId: "d", pointer: "/a/0" })).toBe("$.a[0]");
    expect(
      selectionLabel({
        docId: "d",
        pointer: "/event",
        via: ["/payload", "/inner"],
      }),
    ).toBe("$.payload → $.inner → $.event");
  });
});

describe("statusLabel", () => {
  const index = fakeIndex();
  it("puts every status into words, so color is never the only signal", () => {
    expect(statusLabel(documentFixture())).toEqual({
      tone: "muted",
      text: "Loading",
    });
    expect(
      statusLabel(
        documentFixture({
          status: {
            kind: "indexing",
            index,
            progress: { indexedBytes: 1, totalBytes: 4, records: 0 },
          },
        }),
      ),
    ).toEqual({ tone: "muted", text: "Indexing" });
    expect(
      statusLabel(
        documentFixture({
          bytes: 48 * 1024,
          status: {
            kind: "ready",
            index,
            summary: { records: 0, nodes: 1284 },
          },
        }),
      ),
    ).toEqual({ tone: "ok", text: "Valid", detail: "48 KB · 1,284 nodes" });
    expect(
      statusLabel(
        documentFixture({
          format: "jsonl",
          bytes: 2048,
          status: {
            kind: "ready",
            index,
            summary: { records: 12000, nodes: null },
          },
        }),
      ),
    ).toEqual({ tone: "ok", text: "Valid", detail: "2 KB · 12,000 records" });
  });

  it("counts errors and shows a failure's message as it is", () => {
    const issue = { message: "x", byteOffset: 0, line: 1, column: 1 };
    expect(
      statusLabel(
        documentFixture({
          status: { kind: "invalid", issues: [issue, issue] },
        }),
      ),
    ).toEqual({ tone: "danger", text: "Invalid · 2 errors" });
    expect(
      statusLabel(
        documentFixture({
          status: { kind: "failed", message: "Indexing cancelled." },
        }),
      ),
    ).toEqual({ tone: "danger", text: "Indexing cancelled." });
  });
});
