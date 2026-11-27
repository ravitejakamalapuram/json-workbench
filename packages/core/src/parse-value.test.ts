import { parse as parseLossless } from "lossless-json";
import { describe, expect, it } from "vitest";
import { exportData } from "./export";
import {
  MAX_VALUE_DEPTH,
  NestingTooDeepError,
  parseJsonValue,
  stringifyJsonValue,
} from "./input";
import type { JsonObject } from "./types";

const arrays = (depth: number) => "[".repeat(depth) + "]".repeat(depth);
const objects = (depth: number) =>
  '{"a":'.repeat(depth) + "1" + "}".repeat(depth);

describe("a member named __proto__", () => {
  it("is an own member that leaves the prototype alone", () => {
    const value = parseJsonValue('{"__proto__":"x","a":1}') as JsonObject;
    expect(Object.keys(value)).toEqual(["__proto__", "a"]);
    expect(Object.getOwnPropertyDescriptor(value, "__proto__")?.value).toBe(
      "x",
    );
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  });

  it("does not turn an object value into the prototype", () => {
    const value = parseJsonValue(
      '{"__proto__":{"isAdmin":true}}',
    ) as JsonObject;
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect((value as { isAdmin?: boolean }).isAdmin).toBeUndefined();
    expect(Object.keys(value)).toEqual(["__proto__"]);
  });

  it("is found under an escaped spelling and in nested objects", () => {
    const value = parseJsonValue(
      '[{"\\u005f_proto__":1},{"o":{"__proto__":[2]}}]',
    ) as JsonObject[];
    expect(Object.keys(value[0] ?? {})).toEqual(["__proto__"]);
    expect(Object.keys((value[1]?.["o"] ?? {}) as JsonObject)).toEqual([
      "__proto__",
    ]);
  });

  it("survives stringify, pretty or not, and every export", () => {
    const text = '[{"__proto__":{"x":1},"n":2.50}]';
    const value = parseJsonValue(text);
    expect(stringifyJsonValue(value)).toBe(text);
    expect(stringifyJsonValue(value, true)).toBe(
      '[\n  {\n    "__proto__": {\n      "x": 1\n    },\n    "n": 2.50\n  }\n]',
    );
    expect(exportData(value, "json", { pretty: false })).toBe(text);
    expect(exportData(value, "jsonl")).toBe(`${text.slice(1, -1)}\n`);
    expect(exportData(parseJsonValue('[{"__proto__":"x"}]'), "csv")).toBe(
      "__proto__\nx\n",
    );
  });

  it("is a duplicate like any other key", () => {
    expect(() => parseJsonValue('{"__proto__":1,"__proto__":2}')).toThrow(
      /^Duplicate key '__proto__' encountered/,
    );
  });
});

describe("nesting depth", () => {
  it("reads as deep as the limit and says so beyond it", () => {
    for (const nest of [arrays, objects]) {
      expect(() => parseJsonValue(nest(MAX_VALUE_DEPTH))).not.toThrow();
      expect(() => parseJsonValue(nest(MAX_VALUE_DEPTH + 1))).toThrow(
        new NestingTooDeepError(MAX_VALUE_DEPTH),
      );
    }
  });

  it("states the limit in plain words", () => {
    expect(MAX_VALUE_DEPTH).toBe(1_000);
    expect(() => parseJsonValue(arrays(1_001))).toThrow(
      "Nesting is too deep (limit 1,000 levels)",
    );
  });

  it("fails fast on nesting far past the stack, with no RangeError", () => {
    for (const nest of [arrays, objects])
      expect(() => parseJsonValue(nest(200_000))).toThrow(NestingTooDeepError);
  });

  it("counts only the nesting, not the length", () => {
    const flat = `[${Array.from({ length: 5_000 }, () => "[1]").join(",")}]`;
    expect(() => parseJsonValue(flat)).not.toThrow();
  });

  it("is an error a worker can send by name", () => {
    const error = new NestingTooDeepError(5);
    expect(error.name).toBe("NestingTooDeepError");
    expect(error.limit).toBe(5);
    expect(error).toBeInstanceOf(Error);
  });
});

describe("agrees with the lossless-json parser on everything but those two", () => {
  const valid = [
    "0",
    "-0",
    "1.5e+10",
    '"a\\u00e9\\n\\/\\"\\\\"',
    '"\\ud83d\\ude00 😀"',
    "[]",
    "{}",
    ' \n\t[ 1 , { "a" : [ true , false , null ] } , "x" ] \r\n',
    '{"b":1,"10":2,"9":3,"constructor":4,"toString":5}',
    '{"a":1,"a":1}',
    '{"a":[1,{"b":2}],"a":[1,{"b":2}]}',
    "[900719925474099312345, 1.0, 1E400, -1.5E-400]",
    "﻿[1]",
  ];
  const invalid = [
    "",
    "   ",
    "[",
    "[1,]",
    "[,1]",
    '{"a"}',
    '{"a":1,}',
    "{a:1}",
    "01",
    "1.",
    ".5",
    "+1",
    "1e",
    "[1 2]",
    "tru",
    "truee",
    "nul",
    '"abc',
    '"a\nb"',
    '"\\x"',
    '"\\u12"',
    '"\\u12zz"',
    "[1] x",
    "'a'",
    '{"a":1,"a":2}',
    '{"a":[1],"a":[2]}',
  ];

  it.each(valid)("reads %j to the same value", (text) => {
    expect(parseJsonValue(text)).toEqual(parseLossless(text.replace(/^﻿/, "")));
  });

  it.each(invalid)("refuses %j", (text) => {
    expect(() => parseLossless(text)).toThrow();
    expect(() => parseJsonValue(text)).toThrow();
  });

  it("names a repeated key the way the JWT view expects", () => {
    expect(() => parseJsonValue('{"exp":1,"sub":"a","exp":2}')).toThrow(
      /^Duplicate key 'exp' encountered/,
    );
  });

  it("points a syntax error at its character", () => {
    const at = (text: string) => {
      try {
        parseJsonValue(text);
      } catch (error) {
        return error as { message: string; offset?: number };
      }
      throw new Error("no error");
    };
    expect(at("[1, ?]")).toMatchObject({
      message: "Unexpected character '?'",
      offset: 4,
    });
    expect(at('{"a":1,}')).toMatchObject({
      message: "Expected object property name",
      offset: 7,
    });
    expect(at("[1] x")).toMatchObject({
      message: "Unexpected data after root value",
      offset: 4,
    });
    expect(at('["ab')).toMatchObject({
      message: "Unexpected end of JSON input",
      offset: 1,
    });
    expect(at("   ")).toMatchObject({ message: "JSON input is empty" });
  });
});
