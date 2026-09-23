import { describe, expect, it } from "vitest";
import {
  createDefaultStepFactory,
  diffJson,
  parseJsonValue,
  runPipeline,
  stringifyJsonValue,
  type JsonObject,
} from "@json-workbench/core";
import {
  SAMPLE_FILE_NAME,
  SAMPLE_ORDER_COUNT,
  createSampleOrders,
  createSampleWorkspace,
} from "./sample-data";

describe("sample workspace", () => {
  it("is deterministic, bundled and small enough for the preview", () => {
    const first = createSampleWorkspace();
    const second = createSampleWorkspace();
    expect(first.text).toBe(second.text);
    expect(first.fileName).toBe(SAMPLE_FILE_NAME);
    // The ingest worker previews the first 256 KB; the sample must fit.
    expect(new TextEncoder().encode(first.text).length).toBeLessThan(
      256 * 1024,
    );
  });

  it("contains realistic nested synthetic records", () => {
    const orders = parseJsonValue(createSampleWorkspace().text);
    expect(Array.isArray(orders)).toBe(true);
    const list = orders as JsonObject[];
    expect(list).toHaveLength(SAMPLE_ORDER_COUNT);
    expect(SAMPLE_ORDER_COUNT).toBeGreaterThanOrEqual(50);
    expect(SAMPLE_ORDER_COUNT).toBeLessThanOrEqual(200);
    const order = list[0] as JsonObject;
    expect(order).toHaveProperty("customer.address.country");
    expect(Array.isArray(order.items)).toBe(true);
    for (const item of createSampleOrders())
      expect(String((item.customer as JsonObject).email)).toMatch(
        /@example\.com$/,
      );
  });

  it("ships a filter + JSONata pipeline that runs on the sample", async () => {
    const workspace = createSampleWorkspace();
    expect(workspace.pipeline.steps.map((step) => step.type)).toEqual([
      "filter",
      "jsonata",
    ]);
    const input = parseJsonValue(workspace.text);
    const result = await runPipeline(
      input,
      workspace.pipeline,
      createDefaultStepFactory(),
    );
    const shipped = createSampleOrders().filter(
      (order) => order.status === "shipped",
    );
    expect(shipped.length).toBeGreaterThan(1);
    expect(Array.isArray(result)).toBe(true);
    const rows = result as JsonObject[];
    expect(rows).toHaveLength(shipped.length);
    expect(Object.keys(rows[0] as JsonObject)).toEqual([
      "order",
      "customer",
      "country",
      "items",
      "total",
    ]);
  });

  it("suggests a DuckDB SQL query over the loaded source", () => {
    expect(createSampleWorkspace().sqlQuery).toContain(
      "read_json_auto('source.json')",
    );
  });

  it("prefills a diff target with a few visible changes", () => {
    const workspace = createSampleWorkspace();
    const changes = diffJson(
      parseJsonValue(workspace.text),
      parseJsonValue(workspace.diffText),
    );
    expect(changes.length).toBeGreaterThan(0);
    expect(stringifyJsonValue(parseJsonValue(workspace.diffText))).not.toBe(
      stringifyJsonValue(parseJsonValue(workspace.text)),
    );
  });
});
