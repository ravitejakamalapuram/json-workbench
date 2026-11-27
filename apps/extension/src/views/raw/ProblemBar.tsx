import { Button } from "../../app/ui/Button";
import type { ViewProps } from "../../platform/types";
import { sentence, useProblem } from "./ProblemDetails";

/**
 * The first syntax error and its one-click fix above the editor, for when the
 * details panel (which holds the full Problem block) is closed. Below 1100 px
 * that is the default, and in the 400 px side panel the details cover the
 * editor, so the error and its repair must not depend on opening them.
 */
export default function ProblemBar({ doc }: ViewProps) {
  const { issue, fix, controls } = useProblem(doc);
  if (!issue) return null;
  return (
    <div className="raw-problem-bar" data-testid="raw-problem-bar">
      <p className="raw-problem-bar-text" title={sentence(issue.message)}>
        <strong>
          Line {issue.line.toLocaleString("en-US")}, col{" "}
          {issue.column.toLocaleString("en-US")}
        </strong>{" "}
        {sentence(issue.message)}
      </p>
      <div className="raw-problem-actions">
        {fix && (
          <Button
            variant="primary"
            data-testid="raw-bar-fix"
            onClick={() => controls?.applyFix?.(fix)}
          >
            {fix.label}
          </Button>
        )}
        <Button onClick={() => controls?.goToError(issue)}>Go to error</Button>
      </div>
    </div>
  );
}
