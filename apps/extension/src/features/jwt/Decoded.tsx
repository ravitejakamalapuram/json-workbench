// What a token decoded to: its claims in plain words, then the header, the
// payload and the signature. Every value is shown as a React text node.
import type { JsonObject } from "@json-workbench/core";
import { stringifyJsonValue } from "@json-workbench/core/input";
import { useEffect, useMemo, useReducer, type ReactNode } from "react";
import { Badge } from "../../app/ui/Badge";
import { LIMITS } from "../../platform/types";
import { isExpired, timeClaims } from "./claims";
import { CopyButton } from "./CopyButton";
import type { JwtParts } from "./detect";

const CLOCK_MS = 30_000;
// Indenting adds a level to every line below it, so a few KB of nested brackets
// would print as tens of MB. Past this the value is shown on one line, which is
// no larger than the token.
const PRETTY_MAX = 4 * LIMITS.embeddedChars;

function pretty(value: JsonObject): string {
  const text = stringifyJsonValue(value, true);
  return text.length <= PRETTY_MAX ? text : stringifyJsonValue(value);
}

export function Block({
  title,
  action,
  children,
}: {
  readonly title: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  const heading = `jwt-block-${title.replaceAll(" ", "-").toLowerCase()}`;
  return (
    <section className="jwt-block" aria-labelledby={heading}>
      <div className="jwt-block-head">
        <h3 id={heading} className="caption">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The time, redrawn every 30 s so "expires in 1 minute" is not stale when the page stays open. */
function useClock(): number {
  const [, tick] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    const timer = setInterval(tick, CLOCK_MS);
    return () => clearInterval(timer);
  }, []);
  return Date.now();
}

function Claims({ payload }: Pick<JwtParts, "payload">) {
  const now = useClock();
  const claims = timeClaims(payload, now);
  if (claims.length === 0) return null;
  const expired = isExpired(payload, now);
  return (
    <Block title="Claims">
      <dl className="jwt-claims">
        {claims.map(({ name, label, at }) => (
          <div key={name} className="jwt-claim">
            <dt>{label}</dt>
            <dd>
              {at ? (
                <>
                  <time dateTime={at.iso}>{at.local}</time>
                  {name === "exp" && expired && (
                    <Badge tone="danger">Expired</Badge>
                  )}
                  <span className="jwt-claim-detail">
                    {at.iso} · {at.relative}
                  </span>
                </>
              ) : (
                <span className="muted">Not a valid time</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </Block>
  );
}

/** Issuers sign with a named algorithm; "none" (in any case) means no one did. */
function isUnsigned({ header }: Pick<JwtParts, "header">): boolean {
  const alg = Object.hasOwn(header, "alg") ? header["alg"] : undefined;
  return typeof alg === "string" && alg.toLowerCase() === "none";
}

export function Decoded({ parts }: { readonly parts: JwtParts }) {
  const header = useMemo(() => pretty(parts.header), [parts.header]);
  const payload = useMemo(() => pretty(parts.payload), [parts.payload]);
  const { signature } = parts;
  return (
    <>
      <Claims payload={parts.payload} />
      <Block
        title="Header"
        action={<CopyButton label="Copy header" text={header} />}
      >
        <pre className="jwt-code">{header}</pre>
      </Block>
      <Block
        title="Payload"
        action={<CopyButton label="Copy payload" text={payload} />}
      >
        <pre className="jwt-code" data-testid="jwt-payload">
          {payload}
        </pre>
      </Block>
      <Block
        title="Signature"
        action={
          signature && <CopyButton label="Copy signature" text={signature} />
        }
      >
        {signature ? (
          <code className="jwt-code">{signature}</code>
        ) : (
          <p className="muted">No signature.</p>
        )}
        {isUnsigned(parts) && (
          <p className="muted">
            This token is unsigned: its header sets alg to <code>none</code>.
          </p>
        )}
      </Block>
    </>
  );
}
