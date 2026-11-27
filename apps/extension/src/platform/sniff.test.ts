import { describe, expect, it } from "vitest";
import { looksLikeJson, looksLikeJwt } from "./sniff";

const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

describe("looksLikeJwt", () => {
  it("accepts a signed and an unsigned compact JWS", () => {
    expect(looksLikeJwt(JWT)).toBe(true);
    expect(looksLikeJwt("eyJhbGciOiJub25lIn0.eyJzdWIiOiJhIn0.")).toBe(true);
  });

  it("rejects dotted strings whose segments are not JSON objects", () => {
    expect(looksLikeJwt("a.b.c")).toBe(false);
    expect(looksLikeJwt("api.example.com")).toBe(false);
    expect(looksLikeJwt("eyJhbGciOiJub25lIn0.eyJzdWIiOiJhIn0")).toBe(false);
    expect(looksLikeJwt(` ${JWT}`)).toBe(false);
  });
});

describe("looksLikeJson", () => {
  it("accepts text that opens and closes like an object or array", () => {
    expect(looksLikeJson('{"event":"order.created"}')).toBe(true);
    expect(looksLikeJson("  [1, 2]\n")).toBe(true);
    expect(looksLikeJson("[]")).toBe(true);
    expect(looksLikeJson("{ }")).toBe(true);
  });

  it("rejects prose in brackets and unbalanced text", () => {
    expect(looksLikeJson("[citation needed]")).toBe(false);
    expect(looksLikeJson("{name}")).toBe(false);
    expect(looksLikeJson('{"a":1')).toBe(false);
    expect(looksLikeJson("42")).toBe(false);
    expect(looksLikeJson("")).toBe(false);
  });
});
