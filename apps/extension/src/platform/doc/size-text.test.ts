import { describe, expect, it } from "vitest";
import { sizeAgainst, sizeText } from "./size-text";

const GB = 1024 ** 3;
const MB = 1024 ** 2;

describe("sizeText", () => {
  it("keeps short sizes short", () => {
    expect(sizeText(2048)).toBe("2 KB");
    expect(sizeText(1.5 * MB)).toBe("1.5 MB");
    expect(sizeText(1.25 * GB)).toBe("1.25 GB");
  });
});

describe("sizeAgainst", () => {
  const cap = 1.25 * GB;

  it("reads as it always did when the two differ at the usual precision", () => {
    expect(sizeAgainst(4 * MB, 3 * MB)).toEqual(["4 MB", "3 MB"]);
    expect(sizeAgainst(1.26 * GB, cap)).toEqual(["1.26 GB", "1.25 GB"]);
  });

  it("adds digits when a size just over the cap would read the same as it", () => {
    // 1.2549 GB rounds to the cap's own "1.25 GB" at two decimals.
    const [size, limit] = sizeAgainst(Math.round(1.2549 * GB), cap);
    expect(limit).toBe("1.25 GB");
    expect(size).toBe("1.255 GB");
  });

  it("never reads the same for a size over the cap, down to one byte", () => {
    for (const over of [1, 1000, 10_000, 100_000, 1_000_000, 50_000_000]) {
      const [size, limit] = sizeAgainst(cap + over, cap);
      expect(size).not.toBe(limit);
    }
  });

  it("says the exact bytes when no short spelling tells them apart", () => {
    expect(sizeAgainst(cap + 1, cap)).toEqual([
      "1,342,177,281 bytes",
      "1,342,177,280 bytes",
    ]);
  });
});
