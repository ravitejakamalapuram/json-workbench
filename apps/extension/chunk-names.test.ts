import { describe, expect, it } from "vitest";
import { chunkOwner } from "./vite.config";

describe("chunkOwner", () => {
  it("names chunks after the directory that owns their entry module", () => {
    const src = "/repo/apps/extension/src";
    expect(chunkOwner(`${src}/views/raw/RawView.tsx`)).toBe("views-raw");
    expect(chunkOwner(`${src}/features/compare/CompareMode.tsx`)).toBe(
      "features-compare",
    );
    expect(chunkOwner(`${src}/app/registry.ts`)).toBe("app");
    expect(chunkOwner("/repo/packages/core/src/jq.ts")).toBe("core");
    expect(
      chunkOwner("/repo/node_modules/@codemirror/view/dist/index.js"),
    ).toBe("vendor-codemirror-view");
    expect(chunkOwner("\0vite/preload-helper.js")).toBe("shared");
  });
});
