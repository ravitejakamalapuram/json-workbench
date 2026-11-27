import { parseJsonValue } from "@json-workbench/core";
import { describe, expect, it } from "vitest";
import { buildMemoryIndex } from "../../platform/doc/memory-index";
import type { ParseIssue } from "../../platform/types";
import { suggestFixes, type Change, type Fix } from "./fixes";

/** The issue the doc engine reports for `text`, so the tests use real positions and messages. */
async function issueOf(text: string): Promise<ParseIssue> {
  const built = await buildMemoryIndex(new TextEncoder().encode(text), "json");
  if (built.kind !== "invalid") throw new Error("expected an invalid document");
  const [issue] = built.issues;
  if (!issue) throw new Error("no issue");
  return issue;
}

function apply(text: string, changes: readonly Change[]): string {
  let out = "";
  let at = 0;
  for (const { from, to, insert } of [...changes].sort(
    (a, b) => a.from - b.from,
  )) {
    expect(from).toBeGreaterThanOrEqual(at);
    out += text.slice(at, from) + insert;
    at = to;
  }
  return out + text.slice(at);
}

/** The first suggested fix for the document's first error, and the text it produces. */
async function fixOnce(text: string) {
  const fixes = suggestFixes(text, await issueOf(text));
  const fix = fixes[0];
  if (!fix) throw new Error(`no fix for ${JSON.stringify(text)}`);
  return { fix, text: apply(text, fix.changes) };
}

/** Applies fixes until the document parses; returns each label and the final text. */
async function repair(text: string) {
  const labels: string[] = [];
  for (let step = 0; step < 12; step += 1) {
    const built = await buildMemoryIndex(
      new TextEncoder().encode(text),
      "json",
    );
    if (built.kind === "ready") return { labels, text };
    const issue = built.issues[0]!;
    const fix = suggestFixes(text, issue)[0];
    if (!fix) throw new Error(`stuck at ${issue.message} in ${text}`);
    labels.push(fix.label);
    text = apply(text, fix.changes);
  }
  throw new Error("did not converge");
}

const label = async (text: string) => (await fixOnce(text)).fix.label;

describe("trailing comma", () => {
  it("removes it from an object and from an array", async () => {
    expect((await fixOnce('{"a":1,}')).text).toBe('{"a":1}');
    expect((await fixOnce("[1,2,]")).text).toBe("[1,2]");
  });

  it("keeps the layout around the comma", async () => {
    const broken = '{\n  "id": 1,\n  "name": "Ada",\n}\n';
    const { fix, text } = await fixOnce(broken);
    expect(fix.label).toBe("Remove trailing comma");
    expect(text).toBe('{\n  "id": 1,\n  "name": "Ada"\n}\n');
  });

  it("reaches through whitespace and a nested closer", async () => {
    expect((await fixOnce('{"a":[1, \n ],"b":2}')).text).toBe(
      '{"a":[1 \n ],"b":2}',
    );
  });

  it("fixes every trailing comma and points at the next one", async () => {
    const broken = '{\n  "a": [1,],\n  "b": {"c": 2,},\n}';
    const { fix, text } = await fixOnce(broken);
    expect(fix.label).toBe("Remove trailing commas");
    expect(fix.hint).toBe("Line 3 and 1 more place have the same problem.");
    expect(text).toBe('{\n  "a": [1],\n  "b": {"c": 2}\n}');
  });

  it("leaves commas inside strings alone", async () => {
    expect((await fixOnce('{"a":"x,}",}')).text).toBe('{"a":"x,}"}');
  });
});

describe("single quotes", () => {
  it("turns single-quoted keys and values into double-quoted ones", async () => {
    const { fix, text } = await fixOnce("{'a': 'b'}");
    expect(fix.label).toBe("Use double quotes");
    expect(text).toBe('{"a": "b"}');
  });

  it("escapes double quotes inside and unescapes \\'", async () => {
    expect((await fixOnce(`{"k": 'say "hi"'}`)).text).toBe(
      '{"k": "say \\"hi\\""}',
    );
    expect((await fixOnce(String.raw`['it\'s', 'a\nb']`)).text).toBe(
      String.raw`["it's", "a\nb"]`,
    );
  });

  it("converts every single-quoted string, wherever it is", async () => {
    const { fix, text } = await fixOnce("['a', ['b'],\n 'c']");
    expect(fix.hint).toBe("Line 1 and 1 more place have the same problem.");
    expect(text).toBe('["a", ["b"],\n "c"]');
  });

  it("closes a single-quoted string that ends at the line", async () => {
    expect((await fixOnce("['abc\n]")).text).toBe('["abc"\n]');
  });
});

describe("comments", () => {
  it("removes a line comment that has its line to itself, with the line", async () => {
    const { fix, text } = await fixOnce('// settings\n{"a":1}');
    expect(fix.label).toBe("Remove comment");
    expect(text).toBe('{"a":1}');
  });

  it("removes a trailing line comment and the space before it", async () => {
    expect((await fixOnce('{"a":1, // note\n"b":2}')).text).toBe(
      '{"a":1,\n"b":2}',
    );
  });

  it("removes block comments, inline and over several lines", async () => {
    expect((await fixOnce('{"a": /* one */ 1}')).text).toBe('{"a": 1}');
    expect((await fixOnce('/* a\n b */\n{"a":1}')).text).toBe('{"a":1}');
    expect((await fixOnce('{"a":1} /* end')).text).toBe('{"a":1}');
  });

  it("removes every comment and leaves // inside strings", async () => {
    const broken = '{"url":"http://x", // a\n"b":2 /* c */}';
    const { fix, text } = await fixOnce(broken);
    expect(fix.label).toBe("Remove comments");
    expect(text).toBe('{"url":"http://x",\n"b":2}');
  });
});

describe("unquoted keys", () => {
  it("quotes identifier keys, nested ones too", async () => {
    const { fix, text } = await fixOnce("{a: 1, b_c: {$d: 2}}");
    expect(fix.label).toBe("Quote keys");
    expect(text).toBe('{"a": 1, "b_c": {"$d": 2}}');
  });

  it("quotes keys that look like literals or contain a hyphen", async () => {
    expect((await fixOnce("{name: 1}")).text).toBe('{"name": 1}');
    expect((await fixOnce("{true: 1, a-b: 2}")).text).toBe(
      '{"true": 1, "a-b": 2}',
    );
  });

  it("offers nothing for a bare word that is not followed by a colon", async () => {
    const text = '{"a": 1, foo}';
    expect(suggestFixes(text, await issueOf(text))).toEqual([]);
  });

  it("does not quote a bare word used as a value", async () => {
    const text = '{"a": foo}';
    expect(suggestFixes(text, await issueOf(text))).toEqual([]);
  });
});

describe("missing comma", () => {
  it("adds it after the value before", async () => {
    const { fix, text } = await fixOnce('{"a":1 "b":2}');
    expect(fix.label).toBe("Add comma");
    expect(text).toBe('{"a":1, "b":2}');
  });

  it("adds every comma an array needs", async () => {
    const { fix, text } = await fixOnce("[1 2 3]");
    expect(fix.label).toBe("Add commas");
    expect(text).toBe("[1, 2, 3]");
  });

  it("works across lines and after objects and arrays", async () => {
    expect((await fixOnce('{\n  "a": 1\n  "b": 2\n}')).text).toBe(
      '{\n  "a": 1,\n  "b": 2\n}',
    );
    expect((await fixOnce('[{"a":1} {"b":2}]')).text).toBe(
      '[{"a":1}, {"b":2}]',
    );
    expect((await fixOnce('{"a":[1] "b":{} "c":null}')).text).toBe(
      '{"a":[1], "b":{}, "c":null}',
    );
  });

  it("names the next place that needs one, as the mockup does", async () => {
    const broken =
      '{\n  "email": "ada@example.com"\n  "tier": "gold" "vip": true\n}';
    const { fix } = await fixOnce(broken);
    expect(fix.label).toBe("Add commas");
    expect(fix.hint).toBe('Line 3 also needs a comma after "gold".');
  });

  it("is not offered for a missing colon", async () => {
    const text = '{"a" "b"}';
    expect(suggestFixes(text, await issueOf(text))).toEqual([]);
  });
});

describe("unterminated string", () => {
  it("closes it at the end of its line", async () => {
    const { fix, text } = await fixOnce('{\n  "a": "abc\n}');
    expect(fix.label).toBe("Close the string");
    expect(text).toBe('{\n  "a": "abc"\n}');
  });

  it("closes it before a Windows line break", async () => {
    expect((await fixOnce('{\r\n  "a": "abc\r\n}')).text).toBe(
      '{\r\n  "a": "abc"\r\n}',
    );
  });

  it("closes a string that runs to the end of the text", async () => {
    expect((await fixOnce('"abc')).text).toBe('"abc"');
  });

  it("closes every unterminated string", async () => {
    const { fix, text } = await fixOnce('["a\n"b\n]');
    expect(fix.label).toBe("Close the strings");
    expect(text).toBe('["a"\n"b"\n]');
  });
});

describe("byte order mark", () => {
  it("removes a BOM that the first one left behind", async () => {
    // The engine and Blob.text() each drop one leading BOM; a second one is an error.
    const issue = await issueOf("\uFEFF\uFEFF[1]");
    const [fix] = suggestFixes("\uFEFF[1]", issue);
    expect(fix?.label).toBe("Remove byte order mark");
    expect(apply("\uFEFF[1]", fix?.changes ?? [])).toBe("[1]");
  });

  it("removes one inside the document, but not inside a string", async () => {
    const { fix, text } = await fixOnce('{"a":\uFEFF"\uFEFF"}');
    expect(fix.label).toBe("Remove byte order mark");
    expect(text).toBe('{"a":"\uFEFF"}');
  });
});

describe("positions", () => {
  it("counts columns in UTF-16 units, as the editor does", async () => {
    expect((await fixOnce('{"😀é": 1,}')).text).toBe('{"😀é": 1}');
  });

  it("repairs the record that failed in a JSONL text", async () => {
    const jsonl = '{"a":1}\n{"b":2,}\n{"c":3}\n';
    const issue = await issueOf(jsonl.split("\n")[1]!);
    const [fix] = suggestFixes(jsonl, { ...issue, line: 2 });
    expect(apply(jsonl, fix?.changes ?? [])).toBe(
      '{"a":1}\n{"b":2}\n{"c":3}\n',
    );
  });

  it("offers nothing for an error it cannot repair", async () => {
    for (const text of ['{"a": }', "[1,, 2]", '{"a": tru}', "", '{"a":1}}']) {
      const built = await buildMemoryIndex(
        new TextEncoder().encode(text),
        "json",
      );
      if (built.kind !== "invalid") continue;
      expect(suggestFixes(text, built.issues[0]!)).toEqual([]);
    }
  });

  it("offers nothing when the issue does not point into the text", () => {
    const issue = { message: "x", byteOffset: 0, line: 9, column: 1 };
    expect(suggestFixes('{"a":1,}', issue)).toEqual([]);
  });
});

describe("repairing a whole document", () => {
  it("takes one fix per kind of mistake until it parses", async () => {
    const broken = `// config
{
  name: 'Ada',
  tags: ['a' 'b',],
  "note": "line one
}`;
    const { labels, text } = await repair(broken);
    expect(labels).toEqual([
      "Remove comment",
      "Quote keys",
      "Use double quotes",
      "Add comma",
      "Remove trailing comma",
      "Close the string",
    ]);
    expect(parseJsonValue(text)).toBeTruthy();
  });

  it("repairs a Python-style dict", async () => {
    const { text } = await repair("{'a': [1, 2,], 'b': {'c': null}}");
    expect(text).toBe('{"a": [1, 2], "b": {"c": null}}');
  });
});

describe("cost", () => {
  it("handles many sites in one pass", async () => {
    const items = Array.from({ length: 40_000 }, (_, i) => `{"n":${i}}`);
    const text = `[${items.join(" ")}]`;
    const issue = await issueOf(text);
    const started = performance.now();
    const fixes: readonly Fix[] = suggestFixes(text, issue);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(fixes[0]?.changes).toHaveLength(39_999);
  });
});

describe("labels", () => {
  it("are verbs for every kind", async () => {
    expect(await label('{"a":1,}')).toBe("Remove trailing comma");
    expect(await label("{'a':1}")).toBe("Use double quotes");
    expect(await label("{a:1}")).toBe("Quote key");
  });
});
