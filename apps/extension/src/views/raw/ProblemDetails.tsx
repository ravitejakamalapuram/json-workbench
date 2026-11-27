import type { MouseEvent } from "react";
import { flushSync } from "react-dom";
import { Button } from "../../app/ui/Button";
import type { ViewProps } from "../../platform/types";
import { useAppStoreApi } from "../../store";
import { useRaw } from "./raw-state";

/** The parser's message as a sentence. */
const sentence = (message: string) =>
  message.endsWith(".") ? message : `${message}.`;

/**
 * The first syntax error, where it is and what it says, then the repair
 * offered for it and a way to the spot (Errors mockup). The shell draws the
 * "Problem" heading and hides the section while this renders nothing.
 */
export default function ProblemDetails({ doc }: ViewProps) {
  const store = useAppStoreApi();
  const problem = useRaw((state) => state.problem);
  const controls = useRaw((state) => state.controls);
  const { status } = doc;
  const [issue] = status.kind === "invalid" ? status.issues : [];
  if (!issue) return null;

  // In the side panel the details cover the editor, so what the button does
  // would happen out of sight. They close first, synchronously: closing hands
  // focus back to what opened them, and the editor must take it after that.
  const act = (event: MouseEvent<HTMLElement>, run: () => void) => {
    if (event.currentTarget.closest("[data-overlay]"))
      flushSync(() => store.getState().setDetailsOpen(false));
    run();
  };

  // Fixes computed for an older error, or still being computed, are not offered.
  const [fix] = problem?.issue === issue ? problem.fixes : [];
  return (
    <div className="raw-problem">
      <p className="raw-problem-where" data-testid="raw-error">
        Line {issue.line}, column {issue.column}
      </p>
      <p>{sentence(issue.message)}</p>
      {fix?.hint && <p className="muted">{fix.hint}</p>}
      <div className="raw-problem-actions">
        {fix && (
          <Button
            variant="primary"
            data-testid="raw-apply-fix"
            onClick={(event) => act(event, () => controls?.applyFix?.(fix))}
          >
            {fix.label}
          </Button>
        )}
        <Button
          onClick={(event) => act(event, () => controls?.goToError(issue))}
        >
          Go to error
        </Button>
      </div>
    </div>
  );
}
