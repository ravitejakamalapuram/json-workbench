import type { JsonObject, JsonValue, PipelineStep, PipelineStepContext, PipelineStepDefinition } from "./types";

export class OperationError extends Error { constructor(message: string) { super(message); this.name = "OperationError"; } }
function asArray(input: JsonValue): JsonValue[] { if (!Array.isArray(input)) throw new OperationError("Operation requires an array input"); return input; }
function asObject(input: JsonValue): JsonObject { if (input === null || Array.isArray(input) || typeof input !== "object") throw new OperationError("Operation requires an object input"); return input; }
function fields(config: JsonObject): string[] {
  const value = config.fields;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new OperationError("fields must be an array of strings");
  return value as string[];
}
export function createNativeStep(definition: PipelineStepDefinition): PipelineStep {
  const execute = async (input: JsonValue, _context: PipelineStepContext): Promise<JsonValue> => {
    switch (definition.type) {
      case "pick": {
        const selected = new Set(fields(definition.config));
        return asArray(input).map((item) => { const object = asObject(item); const result: JsonObject = {}; for (const key of selected) if (key in object) result[key] = object[key]!; return result; });
      }
      case "remove": {
        const removed = new Set(fields(definition.config));
        return asArray(input).map((item) => { const object = asObject(item); const result: JsonObject = {}; for (const [key, value] of Object.entries(object)) if (!removed.has(key)) result[key] = value; return result; });
      }
      case "rename": {
        const from = definition.config.from; const to = definition.config.to;
        if (typeof from !== "string" || typeof to !== "string") throw new OperationError("rename requires string from/to");
        return asArray(input).map((item) => { const object = asObject(item); const result: JsonObject = { ...object }; if (from in result) { result[to] = result[from]!; delete result[from]; } return result; });
      }
      case "add": {
        const key = definition.config.key;
        if (typeof key !== "string") throw new OperationError("add requires a string key");
        const value = definition.config.value ?? null;
        return asArray(input).map((item) => ({ ...asObject(item), [key]: value }));
      }
      case "sort": {
        const key = definition.config.key; const direction = definition.config.direction === "desc" ? -1 : 1;
        if (typeof key !== "string") throw new OperationError("sort requires a string key");
        return [...asArray(input)].sort((left, right) => { const a = asObject(left)[key]; const b = asObject(right)[key]; if (a === b) return 0; if (a === undefined || a === null) return -1 * direction; if (b === undefined || b === null) return 1 * direction; return (String(a) < String(b) ? -1 : 1) * direction; });
      }
      case "distinct": {
        const key = definition.config.key;
        if (typeof key !== "string") throw new OperationError("distinct requires a string key");
        const seen = new Set<string>();
        return asArray(input).filter((item) => { const identity = JSON.stringify(asObject(item)[key]) ?? "__undefined__"; if (seen.has(identity)) return false; seen.add(identity); return true; });
      }
      default: throw new OperationError(`Unsupported native operation: ${definition.type}`);
    }
  };
  return { id: definition.id, type: definition.type, enabled: definition.enabled, execute };
}
