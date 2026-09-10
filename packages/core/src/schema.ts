import type { JsonStructureEvent } from "./structure";

export interface InferredSchema {
  readonly types: readonly string[];
  readonly count: number;
  readonly properties?: Readonly<Record<string, InferredSchema>>;
  readonly items?: InferredSchema;
  readonly examples?: readonly string[];
}

export interface GeneratedJsonSchema {
  readonly $schema: "https://json-schema.org/draft/2020-12/schema";
  readonly type?: string | readonly string[];
  readonly properties?: Readonly<Record<string, GeneratedJsonSchema>>;
  readonly items?: GeneratedJsonSchema;
  readonly examples?: readonly string[];
}

type MutableSchema = {
  types: Set<string>;
  count: number;
  properties: Map<string, MutableSchema>;
  items?: MutableSchema;
  examples: string[];
};
type Frame = {
  schema: MutableSchema;
  kind: "object" | "array";
  pendingKey?: string;
};

function node(): MutableSchema {
  return { types: new Set(), count: 0, properties: new Map(), examples: [] };
}
function addType(schema: MutableSchema, type: string, example?: string): void {
  schema.types.add(type);
  schema.count++;
  if (
    example !== undefined &&
    schema.examples.length < 3 &&
    !schema.examples.includes(example)
  )
    schema.examples.push(example);
}
function valueTarget(stack: Frame[], root: MutableSchema): MutableSchema {
  const parent = stack[stack.length - 1];
  if (!parent) return root;
  if (parent.kind === "object") {
    if (!parent.pendingKey) throw new Error("Object value has no property key");
    const key = parent.pendingKey;
    const child = parent.schema.properties.get(key) ?? node();
    parent.schema.properties.set(key, child);
    delete parent.pendingKey;
    return child;
  }
  parent.schema.items ??= node();
  return parent.schema.items;
}
function finalize(schema: MutableSchema): InferredSchema {
  const result: {
    types: readonly string[];
    count: number;
    properties?: Record<string, InferredSchema>;
    items?: InferredSchema;
    examples?: readonly string[];
  } = { types: [...schema.types].sort(), count: schema.count };
  if (schema.properties.size) {
    const properties: Record<string, InferredSchema> = {};
    for (const [key, child] of schema.properties)
      properties[key] = finalize(child);
    result.properties = properties;
  }
  if (schema.items) result.items = finalize(schema.items);
  if (schema.examples.length) result.examples = schema.examples;
  return result;
}
export async function inferSchema(
  events: AsyncIterable<JsonStructureEvent>,
): Promise<InferredSchema> {
  const root = node();
  const stack: Frame[] = [];
  for await (const event of events) {
    if (event.type === "property") {
      const parent = stack[stack.length - 1];
      if (!parent || parent.kind !== "object")
        throw new Error("Property event outside object");
      parent.pendingKey = event.key;
      continue;
    }
    if (event.type === "start-object" || event.type === "start-array") {
      const target = valueTarget(stack, root);
      const kind = event.type === "start-object" ? "object" : "array";
      addType(target, kind);
      stack.push({ schema: target, kind });
      continue;
    }
    if (event.type === "end-object" || event.type === "end-array") {
      stack.pop();
      continue;
    }
    if (event.type === "primitive") {
      const target = valueTarget(stack, root);
      addType(
        target,
        event.primitiveType,
        event.primitiveType === "string" ? event.raw : undefined,
      );
    }
  }
  return finalize(root);
}

function generatedType(
  types: readonly string[],
): string | readonly string[] | undefined {
  if (!types.length) return undefined;
  const normalized = types.map((type) =>
    type === "integer" ? "number" : type,
  );
  return normalized.length === 1
    ? normalized[0]
    : [...new Set(normalized)].sort();
}

export function inferredSchemaToJsonSchema(
  inferred: InferredSchema,
): GeneratedJsonSchema {
  const result: {
    $schema: "https://json-schema.org/draft/2020-12/schema";
    type?: string | readonly string[];
    properties?: Record<string, GeneratedJsonSchema>;
    items?: GeneratedJsonSchema;
    examples?: readonly string[];
  } = { $schema: "https://json-schema.org/draft/2020-12/schema" };
  const type = generatedType(inferred.types);
  if (type !== undefined) result.type = type;
  if (inferred.properties) {
    const properties: Record<string, GeneratedJsonSchema> = {};
    for (const [key, child] of Object.entries(inferred.properties))
      properties[key] = inferredSchemaToJsonSchema(child);
    result.properties = properties;
  }
  if (inferred.items) result.items = inferredSchemaToJsonSchema(inferred.items);
  if (inferred.examples) result.examples = inferred.examples;
  return result;
}

export async function inferJsonSchema(
  events: AsyncIterable<JsonStructureEvent>,
): Promise<GeneratedJsonSchema> {
  return inferredSchemaToJsonSchema(await inferSchema(events));
}
