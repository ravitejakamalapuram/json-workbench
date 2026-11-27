import { LosslessNumber } from "lossless-json";
import { describe, expect, it } from "vitest";
import { changedBlob, CountingBlob } from "../../testing/blobs";
import { TooLargeError, type LoadValueOptions } from "../types";
import { loadValue } from "./load-value";

const json: LoadValueOptions = { format: "json", maxBytes: 64 * 1024 * 1024 };
const jsonl: LoadValueOptions = { ...json, format: "jsonl" };
const blob = (...parts: BlobPart[]) => new Blob(parts);
const KiB = 1024;

describe("loadValue", () => {
  it("returns the value at a pointer with numbers kept digit for digit", async () => {
    const source = blob('{"a":{"n":900719925474099312345},"b/c":["x"]}');
    expect(await loadValue(source, "/a/n", json)).toEqual(
      new LosslessNumber("900719925474099312345"),
    );
    expect(await loadValue(source, "/b~1c/0", json)).toBe("x");
    expect(await loadValue(source, "", json)).toMatchObject({ "b/c": ["x"] });
  });

  it("reads past a BOM", async () => {
    const source = blob(new Uint8Array([0xef, 0xbb, 0xbf]), "[true]");
    expect(await loadValue(source, "/0", json)).toBe(true);
    expect(await loadValue(source, "", json)).toEqual([true]);
  });

  it("reads the whole value of a document that is not a container", async () => {
    expect(await loadValue(blob(' "text" '), "", json)).toBe("text");
    expect(await loadValue(blob("  12  "), "", json)).toEqual(
      new LosslessNumber("12"),
    );
  });

  it("resolves escaped keys, unicode escapes and duplicate keys as parsing does", async () => {
    const source = blob('{"a\\u0062":1,"é":2,"k":1,"k":3}');
    expect(await loadValue(source, "/ab", json)).toEqual(
      new LosslessNumber("1"),
    );
    expect(await loadValue(source, "/é", json)).toEqual(
      new LosslessNumber("2"),
    );
    expect(await loadValue(source, "/k", json)).toEqual(
      new LosslessNumber("3"),
    );
  });

  it("rejects a pointer that leads nowhere", async () => {
    const source = blob('{"a":[1],"n":2,"s":"x"}');
    // "/n/value" would read a field of the LosslessNumber that holds 2.
    for (const pointer of [
      "/b",
      "/a/1",
      "/a/x",
      "/a/01",
      "/a/-",
      "/n/0",
      "/n/value",
      "/s/0",
      "a",
    ])
      await expect(loadValue(source, pointer, json), pointer).rejects.toThrow(
        "Nothing at",
      );
    await expect(loadValue(blob("5"), "/0", json)).rejects.toThrow(
      "Nothing at",
    );
  });

  it("says so when the text ends inside the value", async () => {
    await expect(loadValue(blob('{"a":[1,2'), "/a", json)).rejects.toThrow(
      "ends before",
    );
  });

  it("keeps a member named __proto__, as a value and under its pointer", async () => {
    const source = blob('{"__proto__":{"admin":true},"a":1}');
    const value = (await loadValue(source, "", json)) as object;
    expect(Object.keys(value)).toEqual(["__proto__", "a"]);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(await loadValue(source, "/__proto__/admin", json)).toBe(true);
  });

  it("names the nesting limit instead of overflowing the stack", async () => {
    const deep = (levels: number) => "[".repeat(levels) + "]".repeat(levels);
    expect(await loadValue(blob(deep(1_000)), "", json)).toBeInstanceOf(Array);
    for (const levels of [1_001, 50_000])
      await expect(loadValue(blob(deep(levels)), "", json)).rejects.toThrow(
        "Nesting is too deep (limit 1,000 levels)",
      );
    await expect(
      loadValue(blob(`${deep(1_001)}\n`), "", jsonl),
    ).rejects.toThrow("Nesting is too deep (limit 1,000 levels)");
  });

  describe("in a document above rawEditChars", () => {
    // Four hundred thousand numbers, about 2.7 MB.
    const numbers = Array.from({ length: 400_000 }, (_, at) => at).join(",");
    const array = `[${numbers}]`;
    const wrapper = `{"data":[{"id":1,"name":"Ada"},{"id":2,"name":"Lin"}],"pad":"${"x".repeat(2_500_000)}","meta":{"total":2}}`;

    it("reads a few kilobytes, not the file, to reach an element", async () => {
      const source = new CountingBlob([array]);
      expect(await loadValue(source, "/3", json)).toEqual(
        new LosslessNumber("3"),
      );
      expect(source.reads).toBeLessThan(100 * KiB);
    });

    it("limits the value it loads, not the file it sits in", async () => {
      const source = blob(array);
      const small = { ...json, maxBytes: KiB };
      expect(await loadValue(source, "/399999", small)).toEqual(
        new LosslessNumber("399999"),
      );
      await expect(loadValue(source, "", small)).rejects.toBeInstanceOf(
        TooLargeError,
      );
      const ok = await loadValue(source, "", json);
      expect(ok).toHaveLength(400_000);
    });

    it("loads a value of exactly maxBytes and refuses one byte more", async () => {
      const source = blob('{"s":"abcdef"}');
      // The value is the 8 bytes of "abcdef" with its quotes.
      expect(await loadValue(source, "/s", { ...json, maxBytes: 8 })).toBe(
        "abcdef",
      );
      await expect(
        loadValue(source, "/s", { ...json, maxBytes: 7 }),
      ).rejects.toBeInstanceOf(TooLargeError);
    });

    it("loads a member of a wrapper without the rest of the file", async () => {
      const source = blob(wrapper);
      const small = { ...json, maxBytes: KiB };
      expect(await loadValue(source, "/data/1/name", small)).toBe("Lin");
      expect(await loadValue(source, "/meta", small)).toMatchObject({
        total: new LosslessNumber("2"),
      });
      await expect(loadValue(source, "/pad", small)).rejects.toBeInstanceOf(
        TooLargeError,
      );
    });

    it("refuses the whole file above maxBytes and says how much it can load", async () => {
      const refused = loadValue(blob(array), "", {
        ...json,
        maxBytes: 2 * KiB,
      });
      await expect(refused).rejects.toBeInstanceOf(TooLargeError);
      await expect(refused).rejects.toThrow("2 KB");
    });
  });

  describe("JSONL", () => {
    const source = blob('{"id":1}\n\n{"id":2}\r\n{"id":3}\n');

    it("is an array of its records, blank lines skipped", async () => {
      const all = await loadValue(source, "", jsonl);
      expect(all).toHaveLength(3);
      expect(await loadValue(source, "/2/id", jsonl)).toEqual(
        new LosslessNumber("3"),
      );
      expect(await loadValue(source, "/1", jsonl)).toEqual({
        id: new LosslessNumber("2"),
      });
    });

    it("reads the first maxRecords records, and only their bytes", async () => {
      const counted = new CountingBlob(['{"id":1}\n'.repeat(100_000)]);
      const two = await loadValue(counted, "", { ...jsonl, maxRecords: 2 });
      expect(two).toHaveLength(2);
      expect(counted.reads).toBeLessThan(100 * KiB);
      expect(await loadValue(source, "", { ...jsonl, maxRecords: 0 })).toEqual(
        [],
      );
      expect(
        await loadValue(source, "", { ...jsonl, maxRecords: 50 }),
      ).toHaveLength(3);
    });

    it("applies maxBytes to what it would read, with and without maxRecords", async () => {
      const lines = blob('{"id":1}\n{"id":2}\n{"id":3}\n');
      // Each record is 8 bytes; the file is 27.
      await expect(
        loadValue(lines, "", { ...jsonl, maxBytes: 20 }),
      ).rejects.toBeInstanceOf(TooLargeError);
      await expect(
        loadValue(lines, "", { ...jsonl, maxBytes: 20, maxRecords: 3 }),
      ).rejects.toBeInstanceOf(TooLargeError);
      expect(
        await loadValue(lines, "", { ...jsonl, maxBytes: 20, maxRecords: 2 }),
      ).toHaveLength(2);
      expect(
        await loadValue(lines, "/2", { ...jsonl, maxBytes: 8 }),
      ).toBeTruthy();
    });

    it("does not reach past maxRecords, and reads past a BOM", async () => {
      await expect(
        loadValue(source, "/2", { ...jsonl, maxRecords: 2 }),
      ).rejects.toThrow("Nothing at");
      const withBom = blob(new Uint8Array([0xef, 0xbb, 0xbf]), '{"a":1}\n[2]');
      expect(await loadValue(withBom, "/1/0", jsonl)).toEqual(
        new LosslessNumber("2"),
      );
    });
  });

  it("says what to do when the file changed on disk", async () => {
    await expect(
      loadValue(changedBlob("[1,2]"), "/0", json),
    ).rejects.toMatchObject({
      name: "NotReadableError",
      message: "File changed on disk. Reopen it.",
    });
    await expect(
      loadValue(changedBlob("[1,2]"), "", json),
    ).rejects.toMatchObject({ name: "NotReadableError" });
  });
});
