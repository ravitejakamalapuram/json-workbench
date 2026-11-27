// Owned by item "jwt". F1a stub: the exported names are fixed (TARGET.md section 4).
import type { JsonObject } from "@json-workbench/core";

export type JwtParts = {
  readonly header: JsonObject;
  readonly payload: JsonObject;
  /** The third segment as sent; it is never verified. */
  readonly signature: string;
};

export type JwtError = {
  readonly error: string;
  readonly part: "token" | "header" | "payload";
};

/** Decode only, never verify; never throws. */
export function decodeJwt(_token: string): JwtParts | JwtError {
  return { error: "JWT decoding is not available yet.", part: "token" };
}
