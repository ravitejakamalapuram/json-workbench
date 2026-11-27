import type { PagerRow as Row } from "./pager-ops";

type PagerRowProps = {
  readonly index: number;
  /** Undefined while its rows are being read. */
  readonly row: Row | undefined;
  /** The one row in the tab order. */
  readonly stop: boolean;
  readonly active: boolean;
  readonly error: boolean;
  readonly onSelect: (index: number) => void;
};

/**
 * One 28 px row: a line number in the gutter, and the line as text. A piece of
 * a long line has no number. The document's text is a React text node, never markup.
 */
export function PagerRow({
  index,
  row,
  stop,
  active,
  error,
  onSelect,
}: PagerRowProps) {
  return (
    <div
      role="listitem"
      className="raw-pager-row"
      data-testid="pager-row"
      data-row={index}
      data-active={active || undefined}
      data-error={error || undefined}
      tabIndex={stop ? 0 : -1}
      onClick={() => onSelect(index)}
    >
      <span className="raw-pager-number">
        {row && !row.continued ? row.line : ""}
      </span>
      <span className="raw-pager-text">{row ? row.text : "…"}</span>
    </div>
  );
}
