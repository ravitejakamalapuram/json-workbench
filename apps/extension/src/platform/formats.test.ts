import { LosslessNumber } from "lossless-json";
import { describe, expect, it, vi } from "vitest";
import { detectFormat, indexedFormat, yamlToJson } from "./formats";
import { LIMITS, TooLargeError } from "./types";

vi.mock("../features/yaml/codec", () => ({
  parseYaml: (text: string) =>
    text === "id: 900719925474099312345"
      ? { id: new LosslessNumber("900719925474099312345") }
      : {},
}));

describe("detectFormat", () => {
  it("trusts the file extension", () => {
    expect(detectFormat("orders.json", "")).toBe("json");
    expect(detectFormat("events.JSONL", "")).toBe("jsonl");
    expect(detectFormat("events.ndjson", "")).toBe("jsonl");
    expect(detectFormat("config.yaml", "a: 1")).toBe("yaml");
    expect(detectFormat("config.yml", "a: 1")).toBe("yaml");
  });

  it("sniffs unnamed text as JSON or JSONL, never as YAML", () => {
    expect(detectFormat("Pasted", '{"a":1}\n{"a":2}\n{"a":3}\n')).toBe("jsonl");
    expect(detectFormat("Pasted", '{\n  "a": 1\n}')).toBe("json");
    expect(detectFormat("Pasted", "a: 1")).toBe("json");
  });
});

describe("indexedFormat", () => {
  it("indexes YAML as the JSON it converts to", () => {
    expect(indexedFormat("yaml")).toBe("json");
    expect(indexedFormat("jsonl")).toBe("jsonl");
  });
});

describe("yamlToJson", () => {
  it("writes big integers back with every digit", async () => {
    const json = await yamlToJson(new Blob(["id: 900719925474099312345"]));
    expect(json).toBe('{\n  "id": 900719925474099312345\n}');
  });

  it("refuses input above LIMITS.yamlMaxBytes before reading it", async () => {
    const huge = { size: LIMITS.yamlMaxBytes + 1 } as Blob;
    await expect(yamlToJson(huge)).rejects.toBeInstanceOf(TooLargeError);
  });
});
