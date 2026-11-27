import { describe, expect, it } from "vitest";
import { scanJson } from "./scanner";

async function* chunks(parts: string[]): AsyncGenerator<string> {
  for (const part of parts) yield part;
}

async function collect(parts: string[]) {
  const result = [];
  for await (const token of scanJson(chunks(parts))) result.push(token);
  return result;
}

describe("scanJson", () => {
  it("accepts root primitives at end of stream", async () => {
    await expect(collect(["900719925474099312345"])).resolves.toMatchObject([
      { kind: "number", value: "900719925474099312345" },
    ]);
    await expect(collect(["true"])).resolves.toMatchObject([
      { kind: "literal", value: "true" },
    ]);
  });

  it("keeps strings, numbers, and literals correct across every chunk boundary", async () => {
    const tokens = await collect([
      '{"message":"hel',
      'lo \\"world',
      '\\u263a","n":-1.2',
      '5e+3,"ok":tr',
      "ue}",
    ]);
    expect(
      tokens
        .filter((token) => token.kind === "string")
        .map((token) => token.value),
    ).toEqual(["message", 'hello "world☺', "n", "ok"]);
    expect(tokens.find((token) => token.kind === "number")?.value).toBe(
      "-1.25e+3",
    );
    expect(tokens.find((token) => token.kind === "literal")?.value).toBe(
      "true",
    );
  });

  it("points a string's fault at its place in the whole text, whatever the chunks", async () => {
    // The first chunk is dropped from the buffer before the fault arrives.
    const fault = (parts: string[]) =>
      collect(parts).then(
        () => undefined,
        (error: { message: string; offset: number }) => error,
      );
    expect(await fault(["[1,2,3,", '"ab\\q"'])).toMatchObject({
      message: "Invalid escape sequence",
      offset: 11,
    });
    expect(await fault(['["12345",', '"x\\u12zz"'])).toMatchObject({
      message: "Invalid unicode escape",
      offset: 11,
    });
    expect(await fault(['["12345",', '"x\ty"'])).toMatchObject({
      message: "Unescaped control character in string",
      offset: 11,
    });
  });

  it("names a bad unicode escape at its backslash as soon as a bad digit is in sight", async () => {
    await expect(collect(['"\\u12"'])).rejects.toMatchObject({
      message: "Invalid unicode escape",
      offset: 1,
    });
    // Still to come: the digits the text has so far are fine.
    await expect(collect(['"\\u12'])).rejects.toMatchObject({
      message: "Unexpected end of JSON input",
      offset: 0,
    });
  });

  it("calls a word that cannot become a literal invalid as soon as it is read", async () => {
    await expect(collect(["[tru]"])).rejects.toMatchObject({
      message: "Invalid literal",
      offset: 1,
      bare: true,
    });
    await expect(collect(["[truex]"])).rejects.toMatchObject({
      message: "Invalid literal",
      offset: 1,
    });
    await expect(collect(["[tru"])).rejects.toMatchObject({
      message: "Unexpected end of JSON input",
      offset: 1,
      bare: true,
    });
    // A word cut by a chunk is not wrong yet.
    await expect(collect(["[tr", "ue]"])).resolves.toHaveLength(3);
  });

  it("names a character that starts no token whole, an astral one too", async () => {
    await expect(collect(["[😀]"])).rejects.toMatchObject({
      message: "Unexpected character '😀'",
      offset: 1,
      bare: true,
    });
  });
});
