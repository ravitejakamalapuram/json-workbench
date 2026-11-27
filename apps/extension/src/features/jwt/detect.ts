// Decodes a JWT. It never verifies: the signature is shown as sent, so nothing
// here can say a token is genuine.
import type { JsonObject, JsonValue } from "@json-workbench/core";
import {
  NestingTooDeepError,
  parseJsonValue,
} from "@json-workbench/core/input";
import { LIMITS } from "../../platform/types";

// The tree's badge and this mode agree on what a token looks like because
// both use the one sniff.
export { looksLikeJwt } from "../../platform/sniff";

export type JwtParts = {
  readonly header: JsonObject;
  readonly payload: JsonObject;
  /** The third segment as sent; it is never verified. */
  readonly signature: string;
};

export type JwtError = {
  /** A sentence that says which part is wrong. */
  readonly error: string;
  readonly part: "token" | "header" | "payload";
  /** What the part decoded to, when it decoded but is not a JSON object. */
  readonly text?: string;
};

// A copied Authorization header: the field name and the scheme are not part
// of the token.
const PREFIX = /^\s*(?:authorization\s*:\s*)?(?:bearer\s+)?/i;
// Issuers write no padding, but a token re-encoded elsewhere may carry it.
const BASE64URL = /^[\w-]+={0,2}$/;
const OBJECT = /^\s*\{/;
const utf8 = new TextDecoder();

/** The bytes of a base64url segment, or null when it is not one. */
function fromBase64url(segment: string): Uint8Array | null {
  if (!BASE64URL.test(segment)) return null;
  const bare = segment.replace(/=+$/, "");
  // One character left over can never make a whole byte.
  if (bare.length % 4 === 1) return null;
  const binary = atob(bare.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodePart(
  part: "header" | "payload",
  segment: string,
): { readonly value: JsonObject } | JwtError {
  if (segment === "") return { error: `The ${part} is empty.`, part };
  const bytes = fromBase64url(segment);
  if (!bytes) return { error: `The ${part} is not valid base64url.`, part };
  // Bytes that are not UTF-8 become U+FFFD, so the text can still be shown.
  const text = utf8.decode(bytes);
  let value: JsonValue;
  try {
    value = parseJsonValue(text);
  } catch (error) {
    if (error instanceof NestingTooDeepError)
      return {
        error: `The ${part} decoded, but it is nested too deeply (limit ${error.limit.toLocaleString("en-US")} levels).`,
        part,
        text,
      };
    // The parser refuses a repeated key, which is JSON; say which one.
    const key = /^Duplicate key '(.*)' encountered/.exec(
      error instanceof Error ? error.message : "",
    )?.[1];
    return {
      error:
        key === undefined
          ? `The ${part} decoded, but it is not JSON.`
          : `The ${part} decoded, but the key "${key}" appears more than once.`,
      part,
      text,
    };
  }
  // The text says it is an object; the value cannot, because a number parses
  // to an object as well (a LosslessNumber).
  if (!OBJECT.test(text))
    return {
      error: `The ${part} decoded, but it is not a JSON object.`,
      part,
      text,
    };
  return { value: value as JsonObject };
}

/** Decode only, never verify; never throws. */
export function decodeJwt(token: string): JwtParts | JwtError {
  if (token.length > LIMITS.embeddedChars)
    return { error: "This text is too large to be a token.", part: "token" };
  const segments = token.replace(PREFIX, "").replace(/\s+/g, "").split(".");
  if (segments.length !== 3)
    return {
      error: `A token has 3 parts separated by dots; this one has ${segments.length}.`,
      part: "token",
    };
  const [header = "", payload = "", signature = ""] = segments;
  const decodedHeader = decodePart("header", header);
  if ("error" in decodedHeader) return decodedHeader;
  const decodedPayload = decodePart("payload", payload);
  if ("error" in decodedPayload) return decodedPayload;
  return {
    header: decodedHeader.value,
    payload: decodedPayload.value,
    signature,
  };
}
