// The time claims of a payload. RFC 7519 section 2 defines exp, nbf and iat as
// seconds since 1970 (a NumericDate); everything else about a payload is shown
// as the JSON it is.
import type { JsonObject, JsonValue } from "@json-workbench/core";
import { stringifyJsonValue } from "@json-workbench/core/input";

export type TimeClaim = {
  readonly name: "iat" | "nbf" | "exp";
  readonly label: string;
  /** Null when the value is not a time: not a number, or too far away for a date. */
  readonly at: {
    readonly local: string;
    readonly iso: string;
    /** "expired 3 days ago", "expires in 2 hours". */
    readonly relative: string;
  } | null;
};

// In the order they happen: issued, then valid from, then expired.
const CLAIMS = [
  { name: "iat", label: "Issued", past: "issued", future: "issued" },
  {
    name: "nbf",
    label: "Not before",
    past: "became valid",
    future: "becomes valid",
  },
  { name: "exp", label: "Expires", past: "expired", future: "expires" },
] as const;

// Months and years are approximate: the phrase says how far away, not when.
const UNITS = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
  ["second", 1],
] as const;
// A token issued a moment ago with an hour to live reads "in 1 hour", not
// "in 59 minutes": a unit counts once it is 90% there, and the amount is rounded.
const NEARLY = 0.9;

const relativeFormat = new Intl.RelativeTimeFormat("en", { numeric: "always" });
// Full date and clock with the zone name, in the viewer's locale and zone.
const localFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "long",
});

/** The date a claim names, or null when it is not a number of seconds that makes a date. */
function dateOf(payload: JsonObject, name: string): Date | null {
  // Own properties only: a "__proto__" key sets the prototype, and a claim
  // from there is one the payload shown does not list.
  if (!Object.hasOwn(payload, name)) return null;
  const value: JsonValue | undefined = payload[name];
  if (value === undefined) return null;
  // Numbers parse losslessly, so a number is an object here and only its
  // serialized form reads as one; a string or an object serializes to something
  // that is not a number.
  const date = new Date(Number(stringifyJsonValue(value)) * 1000);
  return Number.isFinite(date.getTime()) ? date : null;
}

function relative(deltaSeconds: number): string {
  const size = Math.abs(deltaSeconds);
  const [unit, length] = UNITS.find(
    ([, seconds]) => size >= seconds * NEARLY,
  ) ?? ["second", 1];
  const amount = Math.round(size / length);
  return relativeFormat.format(deltaSeconds > 0 ? amount : -amount, unit);
}

export function timeClaims(payload: JsonObject, now: number): TimeClaim[] {
  return CLAIMS.flatMap(({ name, label, past, future }): TimeClaim[] => {
    if (!Object.hasOwn(payload, name)) return [];
    const date = dateOf(payload, name);
    if (!date) return [{ name, label, at: null }];
    const delta = (date.getTime() - now) / 1000;
    return [
      {
        name,
        label,
        at: {
          local: localFormat.format(date),
          iso: date.toISOString(),
          relative: `${delta > 0 ? future : past} ${relative(delta)}`,
        },
      },
    ];
  });
}

/** exp is the first second at which the token must no longer be accepted. */
export function isExpired(payload: JsonObject, now: number): boolean {
  const expires = dateOf(payload, "exp");
  return expires !== null && expires.getTime() <= now;
}
