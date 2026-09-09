import { describe, expect, it } from "vitest";
import { createJqStep, evaluateJq, evaluateJqWasm } from "./jq";

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

  it("executes a real jq/WASM filter when the runtime is available", async () => {
    if (typeof window === "undefined") {
      await expect(
        evaluateJqWasm({ users: [{ id: 1 }] }, ".users"),
      ).rejects.toMatchObject({ name: "JqError" });
      return;
    }
    await expect(
      evaluateJqWasm({ users: [{ id: 1 }] }, ".users"),
    ).resolves.toEqual([{ id: 1 }]);
  });
});
