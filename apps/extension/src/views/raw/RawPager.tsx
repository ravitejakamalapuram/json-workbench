// Raw above LIMITS.rawEditChars: the document as read-only lines in the
// shell's VirtualList. A worker counts rows once and reads the few on screen,
// so nothing on this thread grows with the file (TARGET.md section 5).
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { VirtualList, type VirtualListHandle } from "../../app/ui/VirtualList";
import { spacing } from "../../theme/tokens";
import type { ParseIssue, ViewProps } from "../../platform/types";
import { GoToLine, linesText } from "./GoToLine";
import { PagerRow } from "./PagerRow";
import { IDLE, rawState } from "./raw-state";
import { usePager } from "./use-pager";
import "./pager.css";

/** Rows of context left around a row that is jumped to. */
const CONTEXT = 4;
/** The jump target of End while the scan still counts: whatever the last row turns out to be. */
const TO_END = Number.MAX_SAFE_INTEGER;

const keys = new WeakMap<Blob, number>();
let lastKey = 0;
/** A fresh pager for every source: a YAML conversion replaces it, and old rows mean nothing. */
function keyOf(source: Blob): number {
  const key = keys.get(source) ?? ++lastKey;
  keys.set(source, key);
  return key;
}

export default function RawPager({ doc }: ViewProps) {
  const { status } = doc;
  // A refused or unreadable document is not read again here.
  if (status.kind === "failed")
    return <p className="raw-message">{status.message}</p>;
  return <PagerBody key={keyOf(doc.source)} doc={doc} />;
}

function PagerBody({ doc }: ViewProps) {
  const { status, source } = doc;
  const pager = usePager(source);
  const { rows, scanning, show, rowAt, rowOfLine } = pager;
  const list = useRef<VirtualListHandle>(null);
  const box = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [range, setRange] = useState<readonly [number, number]>([0, 0]);
  const [goTo, setGoTo] = useState(false);
  const [message, setMessage] = useState("");
  /** A row to move to as soon as the scan has counted it. */
  const [target, setTarget] = useState<number | null>(null);
  const [errorRow, setErrorRow] = useState<number | null>(null);
  /** The row that should have the keyboard focus as soon as the list has mounted it. */
  const focusRow = useRef<number | null>(null);

  const issue = status.kind === "invalid" ? status.issues[0] : undefined;
  useEffect(() => {
    if (!issue) return;
    let live = true;
    rowAt(issue.byteOffset).then(
      (row) => live && setErrorRow(row),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [issue, rowAt]);

  // What the problem block and the status bar ask of this view.
  useEffect(() => {
    rawState.setState({
      paged: true,
      readOnly: true,
      controls: {
        goToError: (at: ParseIssue) =>
          void rowAt(at.byteOffset).then(setTarget, () => undefined),
      },
    });
    return () => rawState.setState(IDLE);
  }, [rowAt]);

  const here = pager.row(active);
  const line = here?.line;
  const continued = here?.continued;
  useEffect(() => {
    if (line !== undefined)
      rawState.setState({ cursor: { line, column: continued ? null : 1 } });
  }, [line, continued]);

  function reveal(row: number) {
    // Each call moves the list only if the row is on its side of the screen.
    list.current?.scrollToIndex(Math.max(0, row - CONTEXT));
    list.current?.scrollToIndex(Math.min(rows - 1, row + CONTEXT));
  }

  function move(to: number) {
    const row = Math.min(Math.max(0, to), Math.max(0, rows - 1));
    focusRow.current = row;
    setActive(row);
    reveal(row);
  }

  // A jump to a row the scan has not reached waits for it. The effect event
  // reads the latest count and handle; it is listed because
  // eslint-plugin-react-hooks 5 does not know useEffectEvent.
  const jump = useEffectEvent((row: number) => move(row));
  useEffect(() => {
    if (target === null || (target >= rows && scanning)) return;
    setTarget(null);
    // Past the end of a finished scan only End is left: the last row.
    if (target < rows || target === TO_END) jump(target);
  }, [target, rows, scanning, jump]);

  // Moves the focus to the row asked for once the list has mounted it. It
  // names the row, not "the active one": a jump made in an effect commits
  // `active` one render later, and the old row must not take the focus then.
  useEffect(() => {
    if (focusRow.current === null) return;
    const row = box.current?.querySelector<HTMLElement>(
      `[data-row="${focusRow.current}"]`,
    );
    if (!row) return;
    focusRow.current = null;
    row.focus({ preventScroll: true });
  });

  async function goToLine(wanted: number) {
    const row = await rowOfLine(wanted);
    if (row === null) {
      setMessage(
        scanning
          ? `Line ${wanted.toLocaleString("en-US")} is not counted yet.`
          : `The document has ${linesText(pager.lines)}.`,
      );
      return;
    }
    setMessage("");
    setGoTo(false);
    setTarget(row);
  }

  function onKeyDown(event: KeyboardEvent) {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && !event.altKey && !event.shiftKey && event.code === "KeyG") {
      event.preventDefault();
      setGoTo(true);
      return;
    }
    if (mod || event.altKey) return;
    // The list's own height: the mounted range is shorter than a screen plus
    // overscan at the start and the end of the document, where one side is missing.
    const viewport =
      box.current?.querySelector<HTMLElement>('[role="list"]')?.clientHeight ??
      0;
    const screen = Math.max(1, Math.floor(viewport / spacing.row) - 1);
    const to = {
      ArrowDown: active + 1,
      ArrowUp: active - 1,
      PageDown: active + screen,
      PageUp: active - screen,
      Home: 0,
      End: rows - 1,
    }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    // End before the scan is done goes on to the real end once it is counted;
    // any other key ends that wait.
    setTarget(event.key === "End" && scanning ? TO_END : null);
    move(to);
  }

  const onRange = useCallback(
    (start: number, end: number) => {
      setRange((before) =>
        before[0] === start && before[1] === end ? before : [start, end],
      );
      show(start, end);
    },
    [show],
  );

  if (pager.failure) return <p className="raw-message">{pager.failure}</p>;
  const [first, end] = range;
  const stopAt = active >= first && active < end ? active : first;
  return (
    <div
      className="raw-pager"
      data-testid="raw-pager"
      // One gutter width for every row, so the text lines up as the count grows.
      style={{ "--digits": String(pager.lines).length } as CSSProperties}
    >
      {goTo && (
        <GoToLine
          lines={pager.lines}
          scanning={scanning}
          message={message}
          onGo={(wanted) => void goToLine(wanted)}
          onClose={() => {
            focusRow.current = active;
            setGoTo(false);
          }}
        />
      )}
      <div ref={box} className="raw-pager-list" onKeyDown={onKeyDown}>
        {rows === 0 && <p className="raw-message">Reading…</p>}
        <VirtualList
          ref={list}
          role="list"
          aria-label="Document text"
          count={rows}
          onRangeChange={onRange}
          renderRow={(at) => (
            <PagerRow
              index={at}
              row={pager.row(at)}
              stop={at === stopAt}
              active={at === active}
              error={at === errorRow}
              onSelect={setActive}
            />
          )}
        />
      </div>
    </div>
  );
}
