import { describe, expect, it } from "vitest";
import { renamed } from "./names";

describe("renamed", () => {
  it("swaps a data extension", () => {
    expect(renamed("orders.json", "yaml")).toBe("orders.yaml");
    expect(renamed("events.JSONL", "yaml")).toBe("events.yaml");
    expect(renamed("events.ndjson", "yaml")).toBe("events.yaml");
    expect(renamed("config.yml", "json")).toBe("config.json");
    expect(renamed("config.yaml", "json")).toBe("config.json");
  });

  it("adds one to a name that has none, and leaves other dots alone", () => {
    expect(renamed("Pasted text", "yaml")).toBe("Pasted text.yaml");
    expect(renamed("api.example.com", "yaml")).toBe("api.example.com.yaml");
    expect(renamed("notes.txt", "json")).toBe("notes.txt.json");
  });
});
