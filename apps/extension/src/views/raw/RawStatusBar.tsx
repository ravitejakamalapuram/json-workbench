import { LIMITS } from "../../platform/types";
import { useRaw } from "./raw-state";

const MB = LIMITS.rawEditChars / (1024 * 1024);

/** "Ln 7, Col 24" in the bar under the view (Errors mockup), and why the last rewrite did nothing. */
export function RawStatusBar() {
  const cursor = useRaw((state) => state.cursor);
  const readOnly = useRaw((state) => state.readOnly);
  const paged = useRaw((state) => state.paged);
  const notice = useRaw((state) => state.notice);
  const readOnlyText = paged
    ? `Read only: files over ${MB} MB open for reading`
    : "Read only · converted from YAML";
  return (
    <>
      {cursor && (
        <span className="raw-status-cursor" data-testid="raw-cursor">
          Ln {cursor.line.toLocaleString("en-US")}
          {cursor.column === null ? " (continued)" : `, Col ${cursor.column}`}
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
    </>
  );
}
