import { describe, expect, it } from "vitest";
import { createJqStep, evaluateJq } from "./jq";

describe("jq preview engine", () => {
  it("supports paths, pipes, map, and select", () => {
    const input = {
      users: [
        { name: "Ada", active: true },
        { name: "Lin", active: false },
      ],
    };
    expect(evaluateJq(input, ".users | map(.name)")).toEqual(["Ada", "Lin"]);
    expect(evaluateJq(input, ".users | map(select(.active == true))")).toEqual([
      { name: "Ada", active: true },
    ]);
  });

  it("reports unsupported expressions instead of silently mutating", async () => {
    const step = createJqStep({
      id: "jq",
      type: "jq",
      enabled: true,
      config: { expression: ".missing" },
    });
    await expect(
      step.execute({ ok: true }, { mode: "preview", stepIndex: 0 }),
    ).rejects.toMatchObject({ name: "JqError" });
  });
});
