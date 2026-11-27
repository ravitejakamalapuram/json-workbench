import { useRaw } from "./raw-state";

/** "Ln 7, Col 24" in the bar under the view (Errors mockup), and why the last rewrite did nothing. */
export function RawStatusBar() {
  const cursor = useRaw((state) => state.cursor);
  const readOnly = useRaw((state) => state.readOnly);
  const notice = useRaw((state) => state.notice);
  return (
    <>
      {cursor && (
        <span data-testid="raw-cursor">
          Ln {cursor.line}, Col {cursor.column}
        </span>
      )}
      {readOnly && (
        <span className="raw-status-note">Read only · converted from YAML</span>
      )}
      {notice && (
        <span role="status" className="raw-status-note">
          {notice}
        </span>
      )}
    </>
  );
}
