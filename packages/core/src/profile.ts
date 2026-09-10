import { JsonStructureEvent } from "./structure";

export interface JsonProfile {
  readonly nodes: number;
  readonly primitives: number;
  readonly objects: number;
  readonly arrays: number;
  readonly maxDepth: number;
  readonly primitiveTypes: Readonly<Record<string, number>>;
  readonly propertyNames: Readonly<Record<string, number>>;
  readonly fieldStats: Readonly<Record<string, JsonFieldProfile>>;
  readonly depthCounts: Readonly<Record<string, number>>;
  readonly arrayLengths: readonly number[];
}

export interface JsonFieldProfile {
  readonly occurrences: number;
  readonly missing: number;
  readonly nulls: number;
  readonly types: readonly string[];
  readonly examples: readonly string[];
  readonly inconsistent: boolean;
}

export async function profileJsonStructure(
  events: AsyncIterable<JsonStructureEvent>,
): Promise<JsonProfile> {
  let nodes = 0;
  let primitives = 0;
  let objects = 0;
  let arrays = 0;
  let maxDepth = 0;
  const primitiveTypes: Record<string, number> = {};
  const propertyNames: Record<string, number> = {};
  const fieldTypes: Record<string, Set<string>> = {};
  const fieldNulls: Record<string, number> = {};
  const fieldExamples: Record<string, string[]> = {};
  let objectInstances = 0;
  const depthCounts: Record<string, number> = {};
  const arrayLengths: number[] = [];
  const frames: Array<{
    kind: "object" | "array";
    pendingKey?: string;
    items: number;
  }> = [];

  for await (const event of events) {
    nodes++;
    if (event.type === "start-object") {
      objects++;
      if (frames.at(-1)?.kind === "array") frames.at(-1)!.items++;
      objectInstances++;
      depthCounts[String(event.depth)] =
        (depthCounts[String(event.depth)] ?? 0) + 1;
      maxDepth = Math.max(maxDepth, event.depth);
      frames.push({ kind: "object", items: 0 });
    } else if (event.type === "start-array") {
      arrays++;
      if (frames.at(-1)?.kind === "array") frames.at(-1)!.items++;
      depthCounts[String(event.depth)] =
        (depthCounts[String(event.depth)] ?? 0) + 1;
      maxDepth = Math.max(maxDepth, event.depth);
      frames.push({ kind: "array", items: 0 });
    } else if (event.type === "primitive") {
      primitives++;
      primitiveTypes[event.primitiveType] =
        (primitiveTypes[event.primitiveType] ?? 0) + 1;
      const parent = frames[frames.length - 1];
      if (parent?.kind === "array") parent.items++;
      if (parent?.kind === "object" && parent.pendingKey !== undefined) {
        const key = parent.pendingKey;
        fieldTypes[key] ??= new Set();
        fieldTypes[key].add(event.primitiveType);
        if (event.primitiveType === "null")
          fieldNulls[key] = (fieldNulls[key] ?? 0) + 1;
        fieldExamples[key] ??= [];
        if (fieldExamples[key].length < 3 && event.raw !== "null")
          fieldExamples[key].push(event.raw);
        delete parent.pendingKey;
      }
    } else if (event.type === "property") {
      propertyNames[event.key] = (propertyNames[event.key] ?? 0) + 1;
      const parent = frames[frames.length - 1];
      if (parent?.kind === "object") parent.pendingKey = event.key;
      fieldTypes[event.key] ??= new Set();
    } else if (event.type === "end-array") {
      const frame = frames.pop();
      if (frame?.kind === "array") arrayLengths.push(frame.items);
    } else if (event.type === "end-object") {
      frames.pop();
    }
  }

  const fieldStats: Record<string, JsonFieldProfile> = {};
  for (const key of Object.keys(fieldTypes)) {
    const types = [...fieldTypes[key]!].sort();
    const occurrences = propertyNames[key] ?? 0;
    fieldStats[key] = {
      occurrences,
      missing: Math.max(0, objectInstances - occurrences),
      nulls: fieldNulls[key] ?? 0,
      types,
      examples: fieldExamples[key] ?? [],
      inconsistent: types.length > 1,
    };
  }

  return {
    nodes,
    primitives,
    objects,
    arrays,
    maxDepth,
    primitiveTypes,
    propertyNames,
    fieldStats,
    depthCounts,
    arrayLengths,
  };
}
