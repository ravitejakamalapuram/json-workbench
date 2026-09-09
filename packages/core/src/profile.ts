import { JsonStructureEvent } from "./structure";

export interface JsonProfile {
  readonly nodes: number;
  readonly primitives: number;
  readonly objects: number;
  readonly arrays: number;
  readonly maxDepth: number;
  readonly primitiveTypes: Readonly<Record<string, number>>;
  readonly propertyNames: Readonly<Record<string, number>>;
}

export async function profileJsonStructure(events: AsyncIterable<JsonStructureEvent>): Promise<JsonProfile> {
  let nodes = 0;
  let primitives = 0;
  let objects = 0;
  let arrays = 0;
  let maxDepth = 0;
  const primitiveTypes: Record<string, number> = {};
  const propertyNames: Record<string, number> = {};

  for await (const event of events) {
    nodes++;
    if (event.type === "start-object") {
      objects++;
      maxDepth = Math.max(maxDepth, event.depth);
    } else if (event.type === "start-array") {
      arrays++;
      maxDepth = Math.max(maxDepth, event.depth);
    } else if (event.type === "primitive") {
      primitives++;
      primitiveTypes[event.primitiveType] = (primitiveTypes[event.primitiveType] ?? 0) + 1;
    } else if (event.type === "property") {
      propertyNames[event.key] = (propertyNames[event.key] ?? 0) + 1;
    }
  }

  return { nodes, primitives, objects, arrays, maxDepth, primitiveTypes, propertyNames };
}
