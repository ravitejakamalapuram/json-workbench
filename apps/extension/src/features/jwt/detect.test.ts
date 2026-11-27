import { stringifyJsonValue } from "@json-workbench/core/input";
import { describe, expect, it } from "vitest";
import {
  decodeJwt,
  looksLikeJwt,
  type JwtError,
  type JwtParts,
} from "./detect";
import { base64url, makeToken } from "./fixtures";

const HEADER = { alg: "HS256", typ: "JWT" };
const PAYLOAD = { sub: "42", name: "Ada", iat: 1700000000 };

function decoded(token: string): JwtParts {
  const result = decodeJwt(token);
  if ("error" in result) throw new Error(result.error);
  return result;
}

function failed(token: string): JwtError {
  const result = decodeJwt(token);
  if (!("error" in result)) throw new Error("expected an error");
  return result;
}

describe("decodeJwt", () => {
  it("decodes the header and payload and keeps the signature as sent", () => {
    const parts = decoded(makeToken(HEADER, PAYLOAD, "c2lnbmF0dXJl"));
    expect(stringifyJsonValue(parts.header)).toBe(JSON.stringify(HEADER));
    expect(stringifyJsonValue(parts.payload)).toBe(JSON.stringify(PAYLOAD));
    expect(parts.signature).toBe("c2lnbmF0dXJl");
  });

  it("keeps numbers lossless", () => {
    const token = [
      base64url('{"alg":"none"}'),
      base64url('{"id":900719925474099312345,"exp":1.50}'),
      "",
    ].join(".");
    expect(stringifyJsonValue(decoded(token).payload)).toBe(
      '{"id":900719925474099312345,"exp":1.50}',
    );
  });

  it("decodes UTF-8 text", () => {
    const parts = decoded(makeToken(HEADER, { name: "Zoë 日本語 😀" }));
    expect(parts.payload["name"]).toBe("Zoë 日本語 😀");
  });

  it("accepts a bare token with whitespace and line breaks in it", () => {
    const token = makeToken(HEADER, PAYLOAD);
    const wrapped = `  ${token.slice(0, 20)}\r\n${token.slice(20, 50)}\n  ${token.slice(50)}\n`;
    expect(decoded(wrapped)).toEqual(decoded(token));
  });

  it.each([
    ["Bearer "],
    ["bearer "],
    ["Authorization: Bearer "],
    ["authorization:Bearer\t"],
  ])("accepts the prefix %j", (prefix) => {
    const token = makeToken(HEADER, PAYLOAD);
    expect(decoded(prefix + token)).toEqual(decoded(token));
  });

  it("accepts padded base64url", () => {
    const header = Buffer.from(JSON.stringify(HEADER)).toString("base64");
    const payload = Buffer.from('{"a":"bc"}').toString("base64");
    expect(payload.endsWith("==")).toBe(true);
    const parts = decoded(`${header}.${payload}.sig`);
    expect(parts.payload["a"]).toBe("bc");
  });

  it("accepts an empty signature, as an unsigned token has", () => {
    const parts = decoded(makeToken({ alg: "none" }, PAYLOAD, ""));
    expect(parts.signature).toBe("");
  });

  it("says how many parts a token has", () => {
    const token = makeToken(HEADER, PAYLOAD);
    const [header, payload] = token.split(".");
    expect(failed(`${header}.${payload}`)).toEqual({
      error: "A token has 3 parts separated by dots; this one has 2.",
      part: "token",
    });
    expect(failed(`${token}.extra`).error).toContain("this one has 4");
    expect(failed("justonepart").error).toContain("this one has 1");
    expect(failed("").error).toContain("this one has 1");
  });

  it("names the part that is empty", () => {
    expect(failed(`.${base64url("{}")}.sig`)).toMatchObject({
      error: "The header is empty.",
      part: "header",
    });
    expect(failed(`${base64url("{}")}..sig`)).toMatchObject({
      error: "The payload is empty.",
      part: "payload",
    });
  });

  it("names the part that is not base64url", () => {
    const good = base64url("{}");
    expect(failed(`${good}.a!b.sig`)).toMatchObject({
      error: "The payload is not valid base64url.",
      part: "payload",
    });
    expect(failed(`a+b.${good}.sig`)).toMatchObject({
      error: "The header is not valid base64url.",
      part: "header",
    });
    // One leftover character can never be a whole byte.
    expect(failed(`${good}.abcde.sig`).part).toBe("payload");
  });

  it("shows the decoded text of a part that is not JSON", () => {
    const token = [base64url("{}"), base64url("hello, world"), "sig"].join(".");
    expect(failed(token)).toEqual({
      error: "The payload decoded, but it is not JSON.",
      part: "payload",
      text: "hello, world",
    });
    expect(
      failed([base64url("{nope"), base64url("{}"), "sig"].join(".")),
    ).toEqual({
      error: "The header decoded, but it is not JSON.",
      part: "header",
      text: "{nope",
    });
  });

  it("names a key that appears twice, because the text is JSON", () => {
    // RFC 7519 says a receiver must reject this or keep only the last one, so
    // a viewer that showed one value would hide the other.
    const text = '{"exp":1,"sub":"a","exp":2}';
    expect(failed([base64url("{}"), base64url(text), "sig"].join("."))).toEqual(
      {
        error: 'The payload decoded, but the key "exp" appears more than once.',
        part: "payload",
        text,
      },
    );
  });

  it("keeps a claim named __proto__", () => {
    const text = '{"sub":"a","__proto__":{"role":"admin"}}';
    const { payload } = decoded(
      [base64url("{}"), base64url(text), "sig"].join("."),
    );
    expect(Object.keys(payload)).toEqual(["sub", "__proto__"]);
    expect(Object.getPrototypeOf(payload)).toBe(Object.prototype);
    expect(stringifyJsonValue(payload)).toBe(text);
  });

  it("says when a part is nested too deeply to read, not that it is not JSON", () => {
    const text = '{"a":'.repeat(4_500) + "1" + "}".repeat(4_500);
    expect(failed([base64url("{}"), base64url(text), "sig"].join("."))).toEqual(
      {
        error:
          "The payload decoded, but it is nested too deeply (limit 1,000 levels).",
        part: "payload",
        text,
      },
    );
  });

  it.each(["[1,2]", '"text"', "123", "null", "true"])(
    "says when a part is JSON but not an object: %s",
    (text) => {
      expect(
        failed([base64url("{}"), base64url(text), "sig"].join(".")),
      ).toEqual({
        error: "The payload decoded, but it is not a JSON object.",
        part: "payload",
        text,
      });
    },
  );

  it("replaces bytes that are not UTF-8 instead of failing", () => {
    const bad = Buffer.from([0x7b, 0xff, 0x7d]).toString("base64url");
    const result = failed([base64url("{}"), bad, "sig"].join("."));
    expect(result.text).toContain("�");
  });

  it("decodes a 100 KB token", () => {
    const big = "x".repeat(100_000);
    const token = makeToken(HEADER, { big });
    expect(token.length).toBeGreaterThan(100_000);
    expect(decoded(token).payload["big"]).toBe(big);
    expect(looksLikeJwt(token)).toBe(true);
  });

  it("refuses text too large to be a token", () => {
    expect(failed("a".repeat(1024 * 1024 + 1))).toMatchObject({
      part: "token",
      error: expect.stringContaining("too large"),
    });
  });

  it.each([
    "💥.💥.💥",
    "\u0000.\u0000.\u0000",
    "...",
    "\ud800.\udc00.x",
    "=.=.=",
    "Bearer",
    "   ",
  ])("never throws: %j", (text) => {
    expect(() => decodeJwt(text)).not.toThrow();
    expect("error" in decodeJwt(text)).toBe(true);
  });
});

describe("looksLikeJwt", () => {
  it("is the shared sniff, so the tree and this mode agree", () => {
    expect(looksLikeJwt(makeToken(HEADER, PAYLOAD))).toBe(true);
    expect(looksLikeJwt("a.b.c")).toBe(false);
  });
});
