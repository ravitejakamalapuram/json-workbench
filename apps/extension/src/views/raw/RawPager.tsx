// Raw above LIMITS.rawEditChars: the document as read-only lines in the
// shell's VirtualList. A worker counts rows once and reads the few on screen,
// so nothing on this thread grows with the file (TARGET.md section 5).
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { VirtualList, type VirtualListHandle } from "../../app/ui/VirtualList";
import type { ParseIssue, ViewProps } from "../../platform/types";
import { GoToLine } from "./GoToLine";
import { PagerRow } from "./PagerRow";
import { IDLE, rawState } from "./raw-state";
import { usePager } from "./use-pager";
import "./pager.css";

/** VirtualList mounts this many rows beyond each edge of the screen. */
const OVERSCAN = 10;
/** Rows of context left around a row that is jumped to. */
const CONTEXT = 4;

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
  const focusNext = useRef(false);

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
    focusNext.current = true;
    setActive(row);
    reveal(row);
  }

  // A jump to a row the scan has not reached waits for it. The effect event
  // reads the latest count and handle; it is listed because
  // eslint-plugin-react-hooks 5 does not know useEffectEvent.
  const jump = useEffectEvent((row: number) => move(row));
  useEffect(() => {
    if (target === null) return;
    if (target >= rows) {
      if (!scanning) setTarget(null);
      return;
    }
    setTarget(null);
    jump(target);
  }, [target, rows, scanning, jump]);

  // Moves the focus to the active row once the list has mounted it.
  useEffect(() => {
    if (!focusNext.current) return;
    const row = box.current?.querySelector<HTMLElement>(
      `[data-row="${active}"]`,
    );
    if (!row) return;
    focusNext.current = false;
    row.focus({ preventScroll: true });
  });

  async function goToLine(wanted: number) {
    const row = await rowOfLine(wanted);
    if (row === null) {
      setMessage(
        scanning
          ? `Line ${wanted.toLocaleString("en-US")} is not counted yet.`
          : `The document has ${pager.lines.toLocaleString("en-US")} lines.`,
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
    const screen = Math.max(1, range[1] - range[0] - 2 * OVERSCAN);
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
    <div className="raw-pager" data-testid="raw-pager">
      {goTo && (
        <GoToLine
          lines={pager.lines}
          scanning={scanning}
          message={message}
          onGo={(wanted) => void goToLine(wanted)}
          onClose={() => {
            focusNext.current = true;
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
