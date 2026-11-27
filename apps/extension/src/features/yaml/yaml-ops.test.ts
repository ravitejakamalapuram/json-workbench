import { describe, expect, it } from "vitest";
import { TooLargeError } from "../../platform/types";
import type { OpContext } from "../../platform/workers/protocol";
import { parseYaml } from "./codec";
import { yamlHandlers, type YamlOps } from "./yaml-ops";

function run(
  text: string,
  args: { format?: "json" | "jsonl"; maxBytes?: number } = {},
) {
  const phases: string[] = [];
  const ctx = {
    signal: new AbortController().signal,
    progress: (phase: string) => phases.push(phase),
    partial: () => undefined,
  } satisfies OpContext<YamlOps["toYaml"]>;
  const result = yamlHandlers.toYaml(
    {
      source: new Blob([text]),
      format: args.format ?? "json",
      maxBytes: args.maxBytes ?? 1024 * 1024,
    },
    ctx,
  );
  return { phases, result: Promise.resolve(result) };
}

describe("yamlHandlers.toYaml", () => {
  it("writes the document as YAML and reports its two phases", async () => {
    const { phases, result } = run('{"name":"Ada","tags":["a","b"]}');
    const blob = await result;
    expect(await blob.text()).toBe("name: Ada\ntags:\n  - a\n  - b\n");
    expect(phases).toEqual(["reading", "writing"]);
  });

  it("keeps big integers and decimals digit for digit", async () => {
    const { result } = run('{"id":900719925474099312345,"price":1.10}');
    expect(await (await result).text()).toBe(
      "id: 900719925474099312345\nprice: 1.10\n",
    );
  });

  it("writes JSONL as a list of its records", async () => {
    const { result } = run('{"a":1}\n{"a":2}\n', { format: "jsonl" });
    const text = await (await result).text();
    expect(text).toBe("- a: 1\n- a: 2\n");
    expect(parseYaml(text)).toEqual([{ a: 1 }, { a: 2 }]);
  });

  // The JSON reader recurses once per level, and a worker has a small stack;
  // the engine's own message would reach the dialog as it is.
  it("says so in a sentence when nesting is too deep to read", async () => {
    const depth = 200_000;
    const { result } = run("[".repeat(depth) + "1" + "]".repeat(depth), {
      maxBytes: 1024 * 1024,
    });
    await expect(result).rejects.toThrow(/nested too deeply/);
  });

  it("refuses a document over the memory limit before writing anything", async () => {
    const { phases, result } = run('{"a":"' + "x".repeat(200) + '"}', {
      maxBytes: 100,
    });
    await expect(result).rejects.toBeInstanceOf(TooLargeError);
    expect(phases).toEqual(["reading"]);
  });
});
