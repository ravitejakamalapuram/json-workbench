import { Button } from "../../app/ui/Button";
import { LIMITS, MiB } from "../../platform/types";
import { useRaw } from "./raw-state";

const MB = LIMITS.rawEditChars / MiB;

/** "Ln 7, Col 24" in the bar under the view (Errors mockup), why the last rewrite did nothing, and Go to line over the pager. */
export function RawStatusBar() {
  const cursor = useRaw((state) => state.cursor);
  const readOnly = useRaw((state) => state.readOnly);
  const paged = useRaw((state) => state.paged);
  const notice = useRaw((state) => state.notice);
  const goToLine = useRaw((state) => state.controls?.goToLine);
  const readOnlyText = paged
    ? `Read only: files over ${MB} MB open for reading`
    : "Read only · converted from YAML";
  return (
    <>
      {cursor && (
        <span className="raw-status-cursor" data-testid="raw-cursor">
          Ln {cursor.line.toLocaleString("en-US")}
          {cursor.column !== undefined && `, Col ${cursor.column}`}
          {cursor.continued && " (continued)"}
        </span>
      )}
      {readOnly && (
        <span className="raw-status-note" title={readOnlyText}>
          {readOnlyText}
        </span>
      )}
      {notice && (
        <span role="status" className="raw-status-note" title={notice}>
          {notice}
        </span>
      )}
      {goToLine && (
        <Button className="raw-status-action" onClick={goToLine}>
          Go to line
        </Button>
      )}
    </>
  );
}
