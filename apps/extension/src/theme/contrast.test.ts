import { describe, expect, it } from "vitest";
import { colors } from "./tokens";

const channel = (hex: string, at: number) => {
  const c = parseInt(hex.slice(at, at + 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) =>
  0.2126 * channel(hex, 1) +
  0.7152 * channel(hex, 3) +
  0.0722 * channel(hex, 5);
function ratio(a: string, b: string): number {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("accent text on its tints", () => {
  // Badges and the current rail item are small text on --info-bg or --selected.
  it.each(["light", "dark"] as const)(
    "reaches 4.5:1 in the %s theme",
    (theme) => {
      const set = colors[theme];
      expect(ratio(set.accent, set["info-bg"])).toBeGreaterThanOrEqual(4.5);
      expect(ratio(set.accent, set.selected)).toBeGreaterThanOrEqual(4.5);
    },
  );
});
