// The JWT mode (decision 13): paste a token, read its parts. Decode only; the
// signature is never checked. The token lives in jwt-state.ts, in memory.
import { useDeferredValue, useEffect, useMemo, useRef } from "react";
import { Button } from "../../app/ui/Button";
import { Block, Decoded } from "./Decoded";
import { decodeJwt } from "./detect";
import { jwtState, useJwt } from "./jwt-state";
import { usePasteToken } from "./use-paste-token";
import "./jwt.css";

export default function JwtMode() {
  const token = useJwt((state) => state.token);
  const notice = useJwt((state) => state.notice);
  const input = useRef<HTMLTextAreaElement>(null);
  // A large paste decodes after the keystroke has been drawn.
  const shown = useDeferredValue(token);
  const result = useMemo(
    () => (shown.trim() === "" ? null : decodeJwt(shown)),
    [shown],
  );
  const parts = result && !("error" in result) ? result : null;
  const problem = result && "error" in result ? result : null;

  // So that a paste right after opening the mode lands in the box.
  useEffect(() => input.current?.focus(), []);
  usePasteToken(input);

  function clear() {
    jwtState.setState({ token: "", notice: "" });
    input.current?.focus();
  }

  return (
    <section className="jwt" aria-labelledby="jwt-title">
      <div className="jwt-column">
        <header className="jwt-intro">
          <h2 id="jwt-title" className="jwt-title">
            Decode a token
          </h2>
          <p className="muted">
            Decoded here, not verified. The signature is not checked.
          </p>
        </header>
        <div className="jwt-field">
          <label htmlFor="jwt-input" className="jwt-label">
            Paste a token
          </label>
          <textarea
            id="jwt-input"
            ref={input}
            data-testid="jwt-input"
            className="jwt-input"
            rows={5}
            value={token}
            onChange={(event) =>
              jwtState.setState({ token: event.target.value, notice: "" })
            }
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? "jwt-hint jwt-problem" : "jwt-hint"}
          />
          <div className="jwt-field-foot">
            <p id="jwt-hint" className="muted jwt-hint">
              A bare token, or an Authorization: Bearer line. It stays on this
              page and is forgotten when you close it.
            </p>
            <Button onClick={clear} disabled={token === ""}>
              Clear
            </Button>
          </div>
        </div>
        {notice && (
          <p role="status" className="jwt-problem">
            {notice}
          </p>
        )}
        {problem && (
          <>
            <p id="jwt-problem" role="status" className="jwt-problem">
              {problem.error}
            </p>
            {problem.text !== undefined && (
              <Block title="Decoded text">
                <pre className="jwt-code">{problem.text}</pre>
              </Block>
            )}
          </>
        )}
        {parts && <Decoded parts={parts} />}
      </div>
    </section>
  );
}
