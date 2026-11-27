import { LosslessNumber } from "lossless-json";
import { describe, expect, it } from "vitest";
import { LIMITS, TooLargeError, type LoadValueOptions } from "../types";
import { loadValue } from "./load-value";

const json: LoadValueOptions = { format: "json", maxBytes: 64 * 1024 * 1024 };
const jsonl: LoadValueOptions = { ...json, format: "jsonl" };
const blob = (...parts: BlobPart[]) => new Blob(parts);

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
  });

  it("treats JSONL as an array of its records, the first maxRecords of them", async () => {
    const source = blob('{"id":1}\n\n{"id":2}\n{"id":3}\n');
    const all = await loadValue(source, "", jsonl);
    expect(all).toHaveLength(3);
    expect(await loadValue(source, "/2/id", jsonl)).toEqual(
      new LosslessNumber("3"),
    );
    expect(
      await loadValue(source, "", { ...jsonl, maxRecords: 2 }),
    ).toHaveLength(2);
  });

  it("rejects with TooLargeError above maxBytes and above rawEditChars", async () => {
    const source = blob("[1,2,3]");
    await expect(
      loadValue(source, "", { ...json, maxBytes: 6 }),
    ).rejects.toBeInstanceOf(TooLargeError);
    const big = blob(new Uint8Array(LIMITS.rawEditChars + 1));
    await expect(loadValue(big, "", json)).rejects.toBeInstanceOf(
      TooLargeError,
    );
  });

  it("rejects a pointer that leads nowhere", async () => {
    const source = blob('{"a":[1],"n":2}');
    // "/n/value" would read a field of the LosslessNumber that holds 2.
    for (const pointer of ["/b", "/a/1", "/a/x", "/n/0", "/n/value", "a"])
      await expect(loadValue(source, pointer, json), pointer).rejects.toThrow(
        "Nothing at",
      );
  });
});
