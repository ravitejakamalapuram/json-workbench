import { describe, expect, it } from "vitest";
import { rewriteJson } from "./rewrite";

const pretty = (text: string) => rewriteJson(text, true);
const compact = (text: string) => rewriteJson(text, false);

describe("rewriteJson", () => {
  it("indents by two spaces and puts each member and item on its own line", async () => {
    expect(await pretty('{"a":[1,{"b":null}],"c":"x"}')).toBe(
      '{\n  "a": [\n    1,\n    {\n      "b": null\n    }\n  ],\n  "c": "x"\n}',
    );
  });

  it("removes every space that is not part of a string", async () => {
    expect(await compact('{\n  "a" : [ 1 , 2 ],\n  "b" : "x y"\n}\n')).toBe(
      '{"a":[1,2],"b":"x y"}',
    );
  });

  it("keeps empty containers on one line, however deep", async () => {
    expect(await pretty('{"a":[],"b":{},"c":[[],{}]}')).toBe(
      '{\n  "a": [],\n  "b": {},\n  "c": [\n    [],\n    {}\n  ]\n}',
    );
  });

  it("keeps the order of members, integer-like keys included", async () => {
    expect(await pretty('{"b":1,"10":2,"9":3}')).toBe(
      '{\n  "b": 1,\n  "10": 2,\n  "9": 3\n}',
    );
  });

  it("keeps a member named __proto__", async () => {
    expect(await compact('{"__proto__":{"x":1},"a":2}')).toBe(
      '{"__proto__":{"x":1},"a":2}',
    );
  });

  it("keeps duplicate keys, which the document reads as valid", async () => {
    expect(await compact('{ "a": 1, "a": 2 }')).toBe('{"a":1,"a":2}');
  });

  it("keeps the spelling of numbers and the escapes of strings", async () => {
    const spelled =
      '{"n":[1.0,1E5,-0,123456789012345678901234567890],"s":"\\u00e9\\/\\n"}';
    expect(await compact(` ${spelled} `)).toBe(spelled);
  });

  it("does not take brackets, commas or colons inside a string for structure", async () => {
    expect(await pretty('["a,b:{[]}","\\"]"]')).toBe(
      '[\n  "a,b:{[]}",\n  "\\"]"\n]',
    );
  });

  it("rewrites a document that is a single value", async () => {
    expect(await pretty(' "x" ')).toBe('"x"');
    expect(await pretty("12")).toBe("12");
    expect(await pretty("null")).toBe("null");
  });

  it("gives the same text whether it was indented or minified before", async () => {
    const text = '{"a":[1,{"b":[]}],"c":{"d":"é"}}';
    expect(await compact(await pretty(text))).toBe(text);
    expect(await pretty(await compact(await pretty(text)))).toBe(
      await pretty(text),
    );
  });

  it("refuses text that is not JSON, with the parser's reason", async () => {
    await expect(pretty('{"a":1,,}')).rejects.toThrow();
    await expect(compact('{"a":1,}')).rejects.toThrow(/property name/);
    await expect(pretty("")).rejects.toThrow();
  });
});
