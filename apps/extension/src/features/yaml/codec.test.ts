import {
  parseJsonValue,
  stringifyJsonValue,
  type JsonValue,
} from "@json-workbench/core";
import { LosslessNumber } from "lossless-json";
import { describe, expect, it } from "vitest";
import { LIMITS, TooLargeError } from "../../platform/types";
import { parseYaml, stringifyYaml, YamlError } from "./codec";

/** The JSON text of a parsed value, which spells every number the way the file did. */
const json = (value: unknown) =>
  stringifyJsonValue(value as Parameters<typeof stringifyJsonValue>[0]);

/** A refusal's message, for tests that read the sentence rather than the class. */
function refusal(text: string): string {
  try {
    parseYaml(text);
  } catch (error) {
    if (error instanceof Error) return error.message;
  }
  throw new Error("parseYaml accepted the document");
}

describe("parseYaml", () => {
  it("reads nested mappings, sequences, empty containers and scalars", () => {
    const value = parseYaml(
      "name: Ada\ntags: [a, b]\nnested:\n  list:\n    - 1\n    - x: true\n      y: ~\n  empty_map: {}\n  empty_list: []\nflag: false\n",
    );
    expect(value).toEqual({
      name: "Ada",
      tags: ["a", "b"],
      nested: {
        list: [1, { x: true, y: null }],
        empty_map: {},
        empty_list: [],
      },
      flag: false,
    });
  });

  it("reads multi-line strings, unicode and escapes", () => {
    const value = parseYaml(
      'literal: |\n  one\n  two\nfolded: >-\n  one\n  two\nquoted: "tab\\there"\nemoji: "naïve 😀 日本語"\n',
    );
    expect(value).toEqual({
      literal: "one\ntwo\n",
      folded: "one two",
      quoted: "tab\there",
      emoji: "naïve 😀 日本語",
    });
  });

  it("returns null for an empty file", () => {
    expect(parseYaml("")).toBeNull();
    expect(parseYaml("# only a comment\n")).toBeNull();
  });

  it("reads one document that starts with ---", () => {
    expect(parseYaml("---\na: 1\n...\n")).toEqual({ a: 1 });
  });

  describe("numbers", () => {
    it("keeps numbers that a double cannot hold as LosslessNumber, digit for digit", () => {
      const value = parseYaml(
        "big: 12345678901234567890\nneg: -9007199254740993\nprice: 1.10\nlong: 0.1000000000000000055511151231257827\nexp: 1E5\n",
      );
      expect(value).toEqual({
        big: new LosslessNumber("12345678901234567890"),
        neg: new LosslessNumber("-9007199254740993"),
        price: new LosslessNumber("1.10"),
        long: new LosslessNumber("0.1000000000000000055511151231257827"),
        exp: new LosslessNumber("1E5"),
      });
    });

    it("leaves numbers that survive a double as plain numbers", () => {
      expect(
        parseYaml("a: 1\nb: 1.5\nc: -3\nd: 9007199254740991\ne: 1e3"),
      ).toEqual({
        a: 1,
        b: 1.5,
        c: -3,
        d: 9007199254740991,
        // 1e3 prints as 1000, so the file's spelling is kept.
        e: new LosslessNumber("1e3"),
      });
    });

    it("reads hex, octal and other YAML-only spellings as the number they mean", () => {
      expect(parseYaml("a: 0xFF\nb: 0o17\nc: +5\nd: .5\ne: 007")).toEqual({
        a: 255,
        b: 15,
        c: 5,
        d: 0.5,
        e: 7,
      });
      expect(parseYaml("mask: 0xFFFFFFFFFFFFFFFF")).toEqual({
        mask: new LosslessNumber("18446744073709551615"),
      });
    });

    it("writes the same digits back out", () => {
      const text = "big: 12345678901234567890\nprice: 1.10\n";
      expect(stringifyYaml(parseYaml(text))).toBe(text);
    });
  });

  describe("keys", () => {
    it("turns scalar keys into text keys", () => {
      expect(parseYaml("1: a\ntrue: b\nnull: c\n2.50: d\n")).toEqual({
        "1": "a",
        true: "b",
        null: "c",
        "2.50": "d",
      });
    });

    it("keeps a key named __proto__ as data", () => {
      const value = parseYaml("__proto__:\n  polluted: yes\n");
      expect(Object.keys(value as object)).toEqual(["__proto__"]);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it("keeps markup in keys and values as text", () => {
      const value = parseYaml(
        '"<img src=x onerror=alert(1)>": "<script>alert(1)</script>"\n',
      );
      expect(value).toEqual({
        "<img src=x onerror=alert(1)>": "<script>alert(1)</script>",
      });
    });

    it("refuses a key that is a list or a mapping, naming the line", () => {
      expect(refusal("ok: 1\n? [1, 2]\n: x\n")).toBe(
        "Line 2, column 3: A key must be text, a number, true, false or null, not a list or a mapping.",
      );
      expect(refusal("? {a: 1}\n: x\n")).toContain("Line 1");
    });

    it("refuses two keys that become the same text", () => {
      expect(refusal('1: a\n"1": b\n')).toBe(
        'Line 2, column 1: The key "1" appears twice in this mapping.',
      );
    });
  });

  describe("anchors, aliases and merge keys", () => {
    it("expands aliases", () => {
      expect(parseYaml("a: &x [1, 2]\nb: *x\nc: *x\n")).toEqual({
        a: [1, 2],
        b: [1, 2],
        c: [1, 2],
      });
    });

    it("expands merge keys; keys written in the mapping win, earlier merges win over later", () => {
      const value = parseYaml(
        "base: &base {a: 1, b: 2}\nother: &other {b: 3, c: 4}\nitem:\n  <<: [*base, *other]\n  a: 10\n  d: 5\n",
      );
      expect(value).toEqual({
        base: { a: 1, b: 2 },
        other: { b: 3, c: 4 },
        item: { a: 10, b: 2, c: 4, d: 5 },
      });
      expect(Object.keys((value as { item: object }).item)).toEqual([
        "a",
        "b",
        "c",
        "d",
      ]);
    });

    it("lets a key written before a merge key stay", () => {
      expect(parseYaml("base: &b {a: 1}\nitem:\n  a: 9\n  <<: *b\n")).toEqual({
        base: { a: 1 },
        item: { a: 9 },
      });
    });

    it("refuses a billion-laughs document quickly and plainly", () => {
      const levels = [
        'lol0: &lol0 ["lol", "lol", "lol", "lol", "lol", "lol", "lol", "lol", "lol", "lol"]',
      ];
      for (let i = 1; i < 10; i++)
        levels.push(
          `lol${i}: &lol${i} [${Array(10)
            .fill(`*lol${i - 1}`)
            .join(", ")}]`,
        );
      const started = performance.now();
      expect(refusal(levels.join("\n"))).toBe(
        "This file repeats data through anchors and aliases so often that it would expand to more than a million values. It was not opened.",
      );
      expect(performance.now() - started).toBeLessThan(2_000);
    });

    // A long string is one value however long it is, so the count of values
    // alone lets a 1 MiB file ask for gigabytes of JSON.
    it("refuses a long string repeated through aliases until it would fill memory", () => {
      const text = `a: &a "${"x".repeat(1024 * 1024)}"\nb: [${Array(100).fill("*a").join(", ")}]\n`;
      const started = performance.now();
      expect(refusal(text)).toBe(
        "This file repeats data through anchors and aliases so often that it would expand to more than 32 million characters of text. It was not opened.",
      );
      expect(performance.now() - started).toBeLessThan(2_000);
    });

    it("accepts a document that reuses an anchor many times", () => {
      const rows = Array.from({ length: 500 }, (_, i) => `r${i}: *d`);
      const value = parseYaml(["d: &d {x: 1}", ...rows].join("\n"));
      expect(Object.keys(value as object)).toHaveLength(501);
    });

    it("refuses an alias that points at an anchor which does not come before it, naming the line", () => {
      expect(refusal("a: 1\nb: *missing\n")).toBe(
        "Line 2, column 4: The alias *missing has no anchor before it.",
      );
      expect(refusal("a: *later\nb: &later 1\n")).toContain("Line 1");
    });

    it("refuses an alias that sits inside the collection it points at, instead of repeating forever", () => {
      const message =
        "This alias points at the collection it is part of, so it would repeat forever.";
      expect(refusal("a: &x\n  b: *x\n")).toBe(`Line 2, column 6: ${message}`);
      expect(refusal("&a [*a]\n")).toBe(`Line 1, column 5: ${message}`);
      expect(refusal("a: &x [1, {k: *x}]\n")).toContain(message);
    });

    it("accepts an alias to a collection that has been read completely", () => {
      expect(parseYaml("a: &x [1]\nb: [*x, *x]\n")).toEqual({
        a: [1],
        b: [[1], [1]],
      });
    });

    // The package checks every new key against all earlier ones, which took
    // 12 s for 32,000 keys; the codec checks keys itself in constant time.
    it("reads a mapping with tens of thousands of keys in linear time", () => {
      const rows = Array.from({ length: 40_000 }, (_, i) => `r${i}: *d`);
      const value = parseYaml(["d: &d {x: 1}", ...rows].join("\n"));
      expect(Object.keys(value as object)).toHaveLength(40_001);
    }, 8_000);
  });

  it("keeps timestamps as strings, tagged or not", () => {
    expect(
      parseYaml(
        "a: 2001-12-14\nb: 2001-12-14T21:59:43.10-05:00\nc: !!timestamp 2001-12-14\n",
      ),
    ).toEqual({
      a: "2001-12-14",
      b: "2001-12-14T21:59:43.10-05:00",
      c: "2001-12-14",
    });
  });

  describe("refusals", () => {
    it("refuses several documents", () => {
      expect(refusal("a: 1\n---\nb: 2\n")).toBe(
        "This file holds several YAML documents. Open one document at a time.",
      );
    });

    it("refuses .inf and .nan, naming the line", () => {
      expect(refusal("a: 1\nb: .inf\n")).toBe(
        "Line 2, column 4: .inf is not a number JSON can hold.",
      );
      expect(refusal("a: .nan\n")).toBe(
        "Line 1, column 4: .nan is not a number JSON can hold.",
      );
      expect(refusal("a: -.inf\n")).toContain("-.inf is not a number");
    });

    it("refuses binary data, naming the line", () => {
      expect(refusal("a: 1\nimg: !!binary aGk=\n")).toBe(
        "Line 2, column 15: Binary data (!!binary) cannot be shown as JSON.",
      );
    });

    it("explains a syntax error with its line and column", () => {
      try {
        parseYaml("a: 1\nb: [1, 2\nc: 3\n");
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(YamlError);
        const { position, message } = error as YamlError;
        expect(position?.line).toBeGreaterThanOrEqual(2);
        expect(position?.column).toBeGreaterThanOrEqual(1);
        expect(message).toMatch(/^Line \d+, column \d+: [A-Z].*\.$/);
        expect(message).not.toContain("\n");
      }
    });

    it("refuses a duplicate key, naming the line", () => {
      expect(refusal("a: 1\nb: 2\na: 3\n")).toBe(
        'Line 3, column 1: The key "a" appears twice in this mapping.',
      );
    });

    it("refuses input above the YAML limit with the message the file opener uses", () => {
      const big = `a: ${"x".repeat(LIMITS.yamlMaxBytes)}`;
      expect(() => parseYaml(big)).toThrow(TooLargeError);
      expect(refusal(big)).toBe(
        "YAML files up to 8 MB can be opened. Convert it to JSON first.",
      );
    });

    it("counts bytes, not characters, against the limit", () => {
      const wide = `a: ${"日".repeat(Math.ceil(LIMITS.yamlMaxBytes / 3))}`;
      expect(() => parseYaml(wide)).toThrow(TooLargeError);
    });
  });

  it("reads a 200-level nesting", () => {
    const depth = 200;
    const text = `${"[".repeat(depth)}1${"]".repeat(depth)}`;
    let value = parseYaml(text);
    for (let i = 1; i < depth; i++) value = (value as unknown[])[0] as never;
    expect(value).toEqual([1]);
  });

  it("says so when nesting is too deep to read", () => {
    expect(refusal("[".repeat(100_000) + "]".repeat(100_000))).toMatch(
      /nested too deeply/,
    );
  });
});

describe("stringifyYaml", () => {
  const roundTrips = (text: string) => {
    const value = parseJsonValue(text);
    expect(json(parseYaml(stringifyYaml(value)))).toBe(json(value));
  };

  it("writes block YAML with two-space indents", () => {
    expect(
      stringifyYaml(parseJsonValue('{"a":{"b":[1,{"c":null}]},"d":[]}')),
    ).toBe("a:\n  b:\n    - 1\n    - c: null\nd: []\n");
  });

  it("round-trips nested data, empty containers, unicode and multi-line strings", () => {
    roundTrips(
      '{"a":{"b":[1,2,{"c":null}],"e":{}},"f":[],"s":"line one\\nline two\\n","u":"naïve 😀 日本語","t":"\\ttab","q":"x: y # z","sp":" lead","empty":""}',
    );
  });

  it("quotes keys and strings that would read as another type", () => {
    const text = stringifyYaml(
      parseJsonValue(
        '{"1":"a","true":"b","null":"c","n":"1","b":"true","z":"null","date":"2001-12-14","tilde":"~"}',
      ),
    );
    expect(text).toContain('"1": a');
    expect(text).toContain('"true": b');
    expect(text).toContain('"n": "1"');
    expect(text).toContain('date: "2001-12-14"');
    roundTrips(
      '{"1":"a","true":"b","null":"c","n":"1","b":"true","z":"null","date":"2001-12-14","tilde":"~"}',
    );
  });

  // PyYAML, Ruby and Ansible still read YAML 1.1, where "no" is false and a
  // date is a date; a file that changes meaning there is a wrong conversion.
  it("quotes strings that a YAML 1.1 reader would read as a boolean, a date or a number", () => {
    const text = stringifyYaml(
      parseJsonValue(
        '{"country":"no","answer":"Yes","day":"2001-12-14","time":"1:30","group":{"on":"off"}}',
      ),
    );
    expect(text).toBe(
      'country: "no"\nanswer: "Yes"\nday: "2001-12-14"\ntime: "1:30"\ngroup:\n  "on": "off"\n',
    );
    expect(parseYaml(text)).toEqual({
      country: "no",
      answer: "Yes",
      day: "2001-12-14",
      time: "1:30",
      group: { on: "off" },
    });
  });

  // The writer follows YAML 1.2, which this app reads, and also quotes what a
  // 1.1 reader would misread; either alone loses a string on the way back.
  it("quotes strings that YAML 1.2 reads as a number or a merge key", () => {
    const text =
      '{"octal":"0o17","<<":"x","list":["<<"],"nested":{"<<":{"a":1}}}';
    expect(stringifyYaml(parseJsonValue(text))).toBe(
      'octal: "0o17"\n"<<": x\nlist:\n  - "<<"\nnested:\n  "<<":\n    a: 1\n',
    );
    roundTrips(text);
  });

  it("keeps an object whose keys look like a LosslessNumber an object", () => {
    const text = '{"isLosslessNumber":true,"value":"1","count":2}';
    const yaml = stringifyYaml(parseJsonValue(text));
    expect(yaml).toBe('isLosslessNumber: true\nvalue: "1"\ncount: 2\n');
    expect(parseYaml(yaml)).toEqual({
      isLosslessNumber: true,
      value: "1",
      count: 2,
    });
  });

  // lossless-json's parse makes a "__proto__" member the object's prototype,
  // so an object can inherit isLosslessNumber from a number it never held.
  it("does not take an object for a number because its prototype is one", () => {
    const poisoned = Object.setPrototypeOf(
      { constructor: 2 },
      new LosslessNumber("1"),
    );
    expect(stringifyYaml({ k: poisoned })).toBe("k:\n  constructor: 2\n");
  });

  // PyYAML cannot read a plain scalar with a tab inside, and reads a bare "="
  // as its own type; either one makes the whole file fail to load there.
  it("quotes a string with a tab inside and a bare =, which PyYAML cannot read", () => {
    const value = { "a\tb": "x\ty", eq: "=", "=": 1 };
    const text = stringifyYaml(value);
    expect(text).toBe('"a\\tb": "x\\ty"\neq: "="\n"=": 1\n');
    expect(parseYaml(text)).toEqual(value);
  });

  it("writes big integers and decimals with their digits", () => {
    expect(
      stringifyYaml(
        parseJsonValue(
          '{"big":12345678901234567890,"dec":1.10,"long":0.1000000000000000055511151231257827,"small":2}',
        ),
      ),
    ).toBe(
      "big: 12345678901234567890\ndec: 1.10\nlong: 0.1000000000000000055511151231257827\nsmall: 2\n",
    );
  });

  // The package writes these as block scalars and loses the spaces (or writes
  // a file it cannot read back), so they are written in double quotes.
  it("keeps multi-line strings of spaces, and ones that start with spaces, exact", () => {
    for (const text of [
      "  \n",
      " \n \n",
      "\n  x\n",
      " \nno",
      " leading\nsecond",
      "  two\n    four",
    ])
      for (const value of [{ k: text }, [text, 1], text])
        expect(parseYaml(stringifyYaml(value))).toEqual(value);
  });

  // A file that starts with U+FEFF has a byte order mark, which readers drop.
  // CSV headers converted to JSON often carry one on the first key.
  it("keeps a key or a string that starts with U+FEFF", () => {
    for (const value of [
      { "\ufeffid": 1, name: "Ada" },
      "\ufeffid",
      ["\ufeff"],
    ])
      expect(parseYaml(stringifyYaml(value))).toEqual(value);
  });

  it("still writes ordinary multi-line strings as block scalars", () => {
    expect(stringifyYaml({ s: "one\n  two\n\nthree\n" })).toBe(
      "s: |\n  one\n    two\n\n  three\n",
    );
  });

  it("does not fold long strings, so a token stays on one line", () => {
    const token = "word ".repeat(60).trim();
    expect(stringifyYaml({ token })).toBe(`token: ${token}\n`);
  });

  it("keeps markup in keys and values as text", () => {
    roundTrips(
      '{"<img src=x onerror=alert(1)>":"<script>alert(1)</script>","a&b":"\\"quoted\\""}',
    );
  });

  it("writes a scalar document", () => {
    expect(stringifyYaml("hello")).toBe("hello\n");
    expect(stringifyYaml(null)).toBe("null\n");
  });

  it("says so when nesting is too deep to write", () => {
    let value: JsonValue = 1;
    for (let i = 0; i < 20_000; i++) value = [value];
    expect(() => stringifyYaml(value)).toThrow(
      "This document is nested too deeply to write as YAML.",
    );
  });

  it("round-trips a 200-level nesting", () => {
    const depth = 200;
    roundTrips(`${"[".repeat(depth)}1${"]".repeat(depth)}`);
    roundTrips(`${'{"a":'.repeat(depth)}1${"}".repeat(depth)}`);
  });
});
