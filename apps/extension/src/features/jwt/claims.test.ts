import type { JsonObject } from "@json-workbench/core";
import { parseJsonValue } from "@json-workbench/core/input";
import { describe, expect, it } from "vitest";
import { isExpired, timeClaims } from "./claims";

const NOW = Date.UTC(2026, 10, 27, 14, 15, 26);
const seconds = NOW / 1000;
const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

/** Parsed the way the decoder does, so numbers are LosslessNumbers. */
function payload(json: string): JsonObject {
  return parseJsonValue(json) as JsonObject;
}

function phrase(name: "exp" | "iat" | "nbf", offsetSeconds: number): string {
  const claims = timeClaims(
    payload(`{"${name}":${seconds + offsetSeconds}}`),
    NOW,
  );
  return claims[0]?.at?.relative ?? "";
}

describe("timeClaims", () => {
  it("shows a local date, an ISO time and a relative phrase", () => {
    const [claim] = timeClaims(payload(`{"exp":${seconds - 3 * DAY}}`), NOW);
    expect(claim?.name).toBe("exp");
    expect(claim?.label).toBe("Expires");
    expect(claim?.at?.iso).toBe("2026-11-24T14:15:26.000Z");
    expect(claim?.at?.relative).toBe("expired 3 days ago");
    // Locale and zone decide the rest, but it is a date, not the ISO text.
    expect(claim?.at?.local).toContain("2026");
    expect(claim?.at?.local).not.toContain("T14:15");
  });

  it("words the past and the future of each claim", () => {
    expect(phrase("exp", -3 * DAY)).toBe("expired 3 days ago");
    expect(phrase("exp", 2 * HOUR)).toBe("expires in 2 hours");
    expect(phrase("iat", -5 * MINUTE)).toBe("issued 5 minutes ago");
    expect(phrase("iat", 10)).toBe("issued in 10 seconds");
    expect(phrase("nbf", -1 * HOUR)).toBe("became valid 1 hour ago");
    expect(phrase("nbf", 2 * DAY)).toBe("becomes valid in 2 days");
  });

  it("rounds to the nearest whole unit of the largest one that is nearly reached", () => {
    expect(phrase("exp", -44)).toBe("expired 44 seconds ago");
    expect(phrase("exp", -30 * MINUTE)).toBe("expired 30 minutes ago");
    // A moment after issue, a token with an hour to live still says an hour.
    expect(phrase("exp", HOUR - 5)).toBe("expires in 1 hour");
    expect(phrase("exp", 2 * HOUR - 1)).toBe("expires in 2 hours");
    expect(phrase("exp", -(HOUR - 1))).toBe("expired 1 hour ago");
    expect(phrase("exp", 45 * DAY)).toBe("expires in 2 months");
    expect(phrase("exp", 800 * DAY)).toBe("expires in 2 years");
  });

  it("lists the claims that are present, in time order", () => {
    const claims = timeClaims(
      payload(
        `{"exp":${seconds + 60},"sub":"a","nbf":${seconds},"iat":${seconds}}`,
      ),
      NOW,
    );
    expect(claims.map((claim) => claim.name)).toEqual(["iat", "nbf", "exp"]);
    expect(timeClaims(payload('{"sub":"a"}'), NOW)).toEqual([]);
  });

  it("accepts fractional seconds", () => {
    const [claim] = timeClaims(payload(`{"iat":${seconds}.5}`), NOW);
    expect(claim?.at?.iso).toBe("2026-11-27T14:15:26.500Z");
  });

  it.each(['"1700000000"', "true", "null", "[1700000000]", "{}", "1e400"])(
    "marks a claim that is not a time: %s",
    (value) => {
      const [claim] = timeClaims(payload(`{"exp":${value}}`), NOW);
      expect(claim).toMatchObject({ name: "exp", at: null });
    },
  );

  it("marks a time too far away for a date", () => {
    const [claim] = timeClaims(payload('{"exp":99999999999999999999}'), NOW);
    expect(claim?.at).toBeNull();
  });

  // The parser turns a "__proto__" key into the object's prototype, so it is
  // not listed in the payload shown; a claim read through it would be one the
  // reader cannot see.
  it("ignores a claim that is only inherited", () => {
    expect(
      timeClaims(payload('{"__proto__":{"exp":1},"sub":"a"}'), NOW),
    ).toEqual([]);
  });
});

describe("isExpired", () => {
  it("is true from the second exp is reached", () => {
    expect(isExpired(payload(`{"exp":${seconds - 1}}`), NOW)).toBe(true);
    expect(isExpired(payload(`{"exp":${seconds}}`), NOW)).toBe(true);
    expect(isExpired(payload(`{"exp":${seconds + 1}}`), NOW)).toBe(false);
  });

  it("is false without a usable exp", () => {
    expect(isExpired(payload("{}"), NOW)).toBe(false);
    expect(isExpired(payload('{"exp":"soon"}'), NOW)).toBe(false);
    expect(isExpired(payload('{"nbf":1}'), NOW)).toBe(false);
    expect(isExpired(payload('{"__proto__":{"exp":1}}'), NOW)).toBe(false);
  });
});
