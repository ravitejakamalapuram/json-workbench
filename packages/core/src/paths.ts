export type JsonPathSegment = string | number;

export function encodeJsonPointerSegment(segment: JsonPathSegment): string {
  return String(segment).replaceAll("~", "~0").replaceAll("/", "~1");
}

export function decodeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

export function toJsonPointer(segments: readonly JsonPathSegment[]): string {
  return segments.length
    ? `/${segments.map(encodeJsonPointerSegment).join("/")}`
    : "";
}

export function fromJsonPointer(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/"))
    throw new Error("JSON Pointer must start with '/'");
  return pointer.slice(1).split("/").map(decodeJsonPointerSegment);
}

export function toJsonPath(segments: readonly JsonPathSegment[]): string {
  let path = "$";
  for (const segment of segments) {
    if (typeof segment === "number" || !/^[A-Za-z_$][\w$]*$/.test(segment))
      path += `[${typeof segment === "number" ? segment : JSON.stringify(segment)}]`;
    else path += `.${segment}`;
  }
  return path;
}
