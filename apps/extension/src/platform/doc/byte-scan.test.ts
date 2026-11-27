import { describe, expect, it } from "vitest";
import type { IndexedFormat } from "../types";
import { ByteScanner, type ScanIssue, type ScanSink } from "./byte-scan";
import { buildMemoryIndex } from "./memory-index";

const encode = (text: string) => new TextEncoder().encode(text);

type Recorded = string[];

/** Events as "p:key..value" strings so a failure reads like the document. */
function recorder(events: Recorded, bytes: Uint8Array): ScanSink {
  const text = (from: number, to: number) =>
    new TextDecoder().decode(bytes.subarray(from, to));
  return {
    element: (p, memberStart, keyEnd, valueStart, first) =>
      events.push(
        `+${p} ${keyEnd < 0 ? "" : `${text(memberStart, keyEnd)}:`}@${valueStart}${String.fromCharCode(first)}`,
      ),
    end: (p, end) => events.push(`-${p} ${end}`),
  };
}

function scan(
  input: Uint8Array | string,
  format: IndexedFormat,
  { chunk = Infinity, maxDepth = 9, detail = false } = {},
) {
  const bytes = typeof input === "string" ? encode(input) : input;
  const events: Recorded = [];
  const scanner = new ByteScanner({
    format,
    maxDepth,
    detail,
    sink: recorder(events, bytes),
  });
  let issue: ScanIssue | undefined;
  for (let at = 0; at < bytes.length && !issue; at += chunk)
    issue = scanner.write(bytes.subarray(at, at + chunk), at);
  issue ??= scanner.finish(bytes.length);
  return { events, issue };
}

describe("ByteScanner events", () => {
  it("reports elements when they become visible and containers when they end", () => {
    const text = '{"a":[1,{"b":null}],"c":"x"}';
    expect(scan(text, "json", { detail: true }).events).toEqual([
      "+-1 @0{",
      '+0 "a":@5[',
      "+1 @61",
      "-1 7",
      "+1 @8{",
      '+2 "b":@13n',
      "-2 17",
      "-1 18",
      "-0 19",
      '+0 "c":@24"',
      "-0 27",
      "--1 28",
    ]);
  });

  it("gates events by depth and reports primitives' ends only with detail", () => {
    const text = '{"a":[1,{"b":null}],"c":"x"}';
    const shallow = scan(text, "json", { maxDepth: 0 }).events;
    expect(shallow).toEqual([
      "+-1 @0{",
      '+0 "a":@5[',
      "-0 19",
      '+0 "c":@24"',
      "--1 28",
    ]);
  });

  it("treats each JSONL record as an element of a virtual root array", () => {
    const text = '{"id":1}\n\n  "two"\r\n7';
    expect(scan(text, "jsonl", { maxDepth: 0, detail: true }).events).toEqual([
      "+0 @0{",
      "-0 8",
      '+0 @12"',
      "-0 17",
      "+0 @197",
      "-0 20",
    ]);
  });

  it("gives the same events whatever the chunk size", () => {
    const text = `{"k\\u00e9y":[-12.5e+3,true,false,null,"a\\"b\\\\"],"é":{"x":[[],{}]}}`;
    const whole = scan(text, "json", { detail: true });
    expect(whole.issue).toBeUndefined();
    for (let chunk = 1; chunk <= text.length; chunk += 1)
      expect(scan(text, "json", { detail: true, chunk }), `${chunk}`).toEqual(
        whole,
      );
  });

  it("starts inside a container and treats its end as the root's", () => {
    const text = "[1,[2],3]";
    const bytes = encode(text);
    const events: Recorded = [];
    const scanner = new ByteScanner({
      format: "json",
      maxDepth: 0,
      sink: recorder(events, bytes),
    });
    // From the element start of the second child, as from a checkpoint.
    scanner.resume("array", false);
    expect(scanner.write(bytes.subarray(3), 3)).toBeUndefined();
    expect(events).toEqual(["+0 @3[", "-0 6", "+0 @73", "--1 9"]);
  });

  it("jumps over a container the sink already knows the end of", () => {
    const text = "[[1,2,3,[4]],5]";
    const bytes = encode(text);
    const events: string[] = [];
    // The sink reaches the scanner only when it is called, from write().
    const scanner: ByteScanner = new ByteScanner({
      format: "json",
      maxDepth: 5,
      sink: {
        element: (p, _m, _k, valueStart, first) => {
          events.push(`+${p} ${valueStart}`);
          if (first === 0x5b && valueStart === 1) scanner.skipTo(12);
        },
        end: (p, end) => events.push(`-${p} ${end}`),
      },
    });
    for (let at = 0; at < bytes.length; at += 4)
      expect(scanner.write(bytes.subarray(at, at + 4), at)).toBeUndefined();
    expect(scanner.finish(bytes.length)).toBeUndefined();
    expect(events).toEqual(["+-1 0", "+0 1", "+0 13", "--1 15"]);
  });

  it("stops after the event that halts it", () => {
    const bytes = encode("[1,2,3,4]");
    const seen: number[] = [];
    const scanner: ByteScanner = new ByteScanner({
      format: "json",
      maxDepth: 0,
      sink: {
        element: (p, _m, _k, valueStart) => {
          if (p === 0) seen.push(valueStart);
          if (seen.length === 2) scanner.halt();
        },
        end: () => undefined,
      },
    });
    scanner.write(bytes, 0);
    expect(seen).toEqual([1, 3]);
  });
});

describe("ByteScanner errors", () => {
  const cases: [string, string, number][] = [
    ["a trailing comma in an object", '{"a":1,}', 7],
    ["a trailing comma in an array", "[1,]", 3],
    ["a missing comma", '{"a":1 "b":2}', 7],
    ["a missing colon", '{"a" 1}', 5],
    ["a bare word", "[oops]", 1],
    ["a single quote", "{'a':1}", 1],
    ["a number with a leading zero", "[01]", 1],
    ["a number with trailing junk", "[1x]", 1],
    ["a number ending in a dot", "[1.]", 1],
    ["a number ending in an exponent mark", "[1e]", 1],
    ["a literal with trailing letters", "[truex]", 1],
    ["a misspelled literal", "[nul]", 1],
    ["an unterminated string", '["abc', 1],
    ["a raw control character in a string", '["a\tb"]', 3],
    ["a bad escape", '["a\\qb"]', 4],
    ["a bad unicode escape", '["\\u00zz"]', 2],
    ["data after the root", "[1] 2", 4],
    ["a closer of the wrong kind", "[1}", 2],
    ["an early end after a comma", "[1,", 3],
    ["an early end in an object", '{"a"  \n', 4],
    ["an early end with blanks left", "[1, 2  \n\n", 5],
    ["an early end in a number", "-", 0],
    ["a stray closer", "]", 0],
    ["a misplaced string", '["a" "b"]', 5],
    ["a misplaced string with an error of its own", '["a" "b\tc"]', 7],
  ];
  it.each(cases)("reports %s at its offset", (_name, text, offset) => {
    expect(scan(text, "json").issue?.offset).toBe(offset);
    expect(scan(text, "json", { chunk: 1 }).issue?.offset).toBe(offset);
  });

  it("reports an empty document at its start", () => {
    expect(scan("  \n", "json").issue).toMatchObject({
      offset: 0,
      message: "JSON input is empty",
    });
  });

  it("cuts a JSONL record at its line", () => {
    expect(scan('{"a":1}\n{"b":\n[2]', "jsonl").issue?.offset).toBe(13);
    expect(scan('{"a":1}\n"open\n[2]', "jsonl").issue?.offset).toBe(8);
    expect(scan('{"a":1} 2', "jsonl").issue?.offset).toBe(8);
  });

  it("names the byte that cannot start a value", () => {
    expect(scan("[ê]", "json").issue).toMatchObject({
      offset: 1,
      unexpected: true,
    });
  });

  it("bounds nesting instead of growing without limit", () => {
    const issue = scan("[".repeat(100_001), "json").issue;
    expect(issue?.message).toContain("100,000");
  });
});

/** A small deterministic generator, so a failing case can be replayed. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = [
  '{"a":1,"b":[true,null,"x\\n\\u00e9é"],"c":{"d":-1.5e+3}}',
  '[1,2,{"k":"v"},[],{},"😀",0,-0,0.5,1E2]',
  '"just a string"',
  "123",
  '{"deep":[[[[{"x":[1,[2,[3]]]}]]]]}',
];

describe("ByteScanner against the memory index", () => {
  // The two engines must call the same documents invalid and point at the
  // same byte, so a document never changes verdict across the 2 MiB line.
  const noop: ScanSink = { element: () => undefined, end: () => undefined };
  async function agree(bytes: Uint8Array, format: IndexedFormat) {
    const built = await buildMemoryIndex(bytes, format);
    const scanner = new ByteScanner({ format, maxDepth: 3, sink: noop });
    const start =
      bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
    const issue =
      scanner.write(bytes.subarray(start), start) ??
      scanner.finish(bytes.length);
    const expected =
      built.kind === "ready" ? undefined : built.issues[0]?.byteOffset;
    expect(issue?.offset, new TextDecoder().decode(bytes)).toBe(expected);
  }

  it("agrees on one-byte edits of valid JSON", async () => {
    const next = random(1);
    const noise = encode('"\\,:{}[] \n-.e0aeé\u0001\t');
    for (let round = 0; round < 1500; round += 1) {
      const base = encode(PIECES[Math.floor(next() * PIECES.length)] ?? "");
      const at = Math.floor(next() * base.length);
      const byte = noise[Math.floor(next() * noise.length)] ?? 0x20;
      const edit = next();
      const mutant = Uint8Array.from(
        edit < 0.4
          ? [...base.subarray(0, at), byte, ...base.subarray(at + 1)]
          : edit < 0.7
            ? [...base.subarray(0, at), ...base.subarray(at + 1)]
            : edit < 0.9
              ? [...base.subarray(0, at), byte, ...base.subarray(at)]
              : base.subarray(0, at),
      );
      await agree(mutant, "json");
    }
  });

  it("agrees on edits of JSONL", async () => {
    const next = random(2);
    const noise = encode('"\\,:{}[] \n-.e0a\r');
    const lines = ['{"a":1}', "[1,2]", '"x"', "", "  ", "7", '{"b":{"c":[]}}'];
    for (let round = 0; round < 800; round += 1) {
      const text = Array.from(
        { length: 1 + Math.floor(next() * 5) },
        () => lines[Math.floor(next() * lines.length)],
      ).join(next() < 0.5 ? "\n" : "\r\n");
      const base = encode(text);
      const at = Math.floor(next() * (base.length + 1));
      const byte = noise[Math.floor(next() * noise.length)] ?? 0x20;
      const mutant = Uint8Array.from(
        next() < 0.5
          ? [...base.subarray(0, at), byte, ...base.subarray(at + 1)]
          : [...base.subarray(0, at), byte, ...base.subarray(at)],
      );
      await agree(mutant, "jsonl");
    }
  });
});
