import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  OUTPUTS,
  generateTokenFiles,
  readTokens,
  renderTokensCss,
} from "./gen-tokens.mjs";

const tokens = readTokens();

function color(theme, name) {
  return tokens.color.tokens.find((token) => token.name === name)?.value[theme];
}

// Relative luminance per WCAG 2, on the RGB channels only.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("gen-tokens", () => {
  it("puts light colors on :root and dark colors under data-theme=dark", () => {
    const css = renderTokensCss(tokens);
    const [light, dark] = css.split(':root[data-theme="dark"]');
    expect(light).toContain("--bg: #ffffff;");
    expect(light).toContain("color-scheme: light;");
    expect(dark).toContain("--bg: #1c1d21;");
    expect(dark).toContain("color-scheme: dark;");
  });

  it("emits fonts, type styles, spacing and radius as custom properties", () => {
    const css = renderTokensCss(tokens);
    expect(css).toMatch(/--font-sans: "Inter Variable"/);
    expect(css).toContain("--type-body: 400 14px/20px var(--font-sans);");
    expect(css).toContain("--type-code: 400 13px/24px var(--font-mono);");
    expect(css).toContain("--row: 28px;");
    expect(css).toContain("--radius-md: 6px;");
  });

  it("defines a scrim that dims the page in both themes", () => {
    for (const theme of ["light", "dark"]) {
      const scrim = color(theme, "scrim");
      expect(scrim, theme).toMatch(/^#[0-9a-f]{8}$/);
      const alpha = parseInt(scrim.slice(7, 9), 16) / 255;
      expect(alpha, theme).toBeGreaterThanOrEqual(0.2);
      expect(luminance(scrim), theme).toBeLessThan(
        luminance(color(theme, "bg")),
      );
    }
  });

  it("exports colors per theme and spacing in pixels for TypeScript", async () => {
    const { ts } = await generateTokenFiles(tokens);
    expect(ts).toContain('bg: "#ffffff"');
    expect(ts).toContain('bg: "#1c1d21"');
    expect(ts).toMatch(/row: 28,/);
    expect(ts).toContain("export type ColorToken = keyof typeof colors.light;");
  });

  it("matches the committed theme files", async () => {
    const generated = await generateTokenFiles(tokens);
    for (const [key, path] of Object.entries(OUTPUTS))
      expect(readFileSync(path, "utf8"), path).toBe(generated[key]);
  });
});
