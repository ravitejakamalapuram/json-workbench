import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { spacing } from "../../theme/tokens";

const ROW = spacing.row;
const OVERSCAN = 10;
/**
 * Chromium caps an element's height near 33.5M px, about 1.2M rows. Above
 * this the spacer stops growing and the scroll position maps to the first
 * visible row in proportion (TARGET.md section 5).
 */
export const MAX_SPACER_PX = 10_000_000;

/**
 * The list's viewport height when it cannot be measured: happy-dom reports
 * clientHeight 0, so testing/render.tsx provides a fixed height here.
 */
export const ViewportHeightContext = createContext<number | null>(null);

export type VirtualListHandle = {
  /** Scrolls the least needed to show the row. */
  scrollToIndex(index: number): void;
  /** The first row in view, fractional; what scrollToTop takes. */
  top(): number;
  /** Puts `top` (a row, fractional) at the top, as far as the rows allow. */
  scrollToTop(top: number): void;
};

type VirtualListProps = {
  readonly count: number;
  readonly renderRow: (index: number) => ReactNode;
  /** "grid" makes each row a role="row" with aria-rowindex; for other roles the row content carries its own role. */
  readonly role: "grid" | "tree" | "listbox" | "list";
  readonly "aria-label": string;
  /** Rows and header are at least this wide (px), so a wide table scrolls sideways inside the list. */
  readonly contentMinWidth?: number;
  /** One sticky row above the rows (column headers); counted in aria-rowcount. */
  readonly header?: ReactNode;
  /** Called with the mounted range [start, end); pass a stable function. */
  readonly onRangeChange?: (start: number, end: number) => void;
  readonly ref?: Ref<VirtualListHandle>;
};

type Position = { readonly top: number; readonly scrollTop: number };

/**
 * Fixed 28 px rows; only the visible rows plus 10 above and below are
 * mounted. `top` (in rows, fractional) is the source of truth; each row sits
 * at scrollTop + (index - top) * 28, which is index * 28 below the cap and
 * keeps the row at `top` flush with the viewport above it.
 */
export function VirtualList({
  count,
  renderRow,
  role,
  "aria-label": label,
  contentMinWidth,
  header,
  onRangeChange,
  ref,
}: VirtualListProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const forcedHeight = useContext(ViewportHeightContext);
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const [position, setPosition] = useState<Position>({ top: 0, scrollTop: 0 });
  /** The scrollTop this list last wrote, so its own scroll event keeps the exact `top`. */
  const written = useRef(0);

  const headerRows = header === undefined ? 0 : 1;
  const viewport = Math.max(
    0,
    (forcedHeight ?? measuredHeight) - headerRows * ROW,
  );
  const viewportRows = viewport / ROW;
  const spacer = Math.min(count * ROW, MAX_SPACER_PX);
  const maxScroll = Math.max(0, spacer - viewport);
  const maxTop = Math.max(0, count - viewportRows);
  const scaled = count * ROW > MAX_SPACER_PX;

  const topFor = (scrollTop: number) =>
    maxScroll > 0 ? (scrollTop / maxScroll) * maxTop : 0;

  function moveTo(top: number) {
    const element = scroller.current;
    if (!element) return;
    const clamped = Math.min(Math.max(0, top), maxTop);
    written.current = maxTop > 0 ? (clamped / maxTop) * maxScroll : 0;
    element.scrollTop = written.current;
    setPosition({ top: clamped, scrollTop: element.scrollTop });
  }

  useImperativeHandle(ref, () => ({
    scrollToIndex(index) {
      const { top } = position;
      if (index < top) moveTo(index);
      else if (index + 1 > top + viewportRows) moveTo(index + 1 - viewportRows);
    },
    top: () => Math.min(position.top, maxTop),
    scrollToTop: moveTo,
  }));

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || forcedHeight !== null) return;
    const measure = () => setMeasuredHeight(element.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [forcedHeight]);

  // Scaled pixels would move about 0.6 rows per pixel at 6M rows, so above
  // the cap the wheel moves by rows. Native listener: React's is passive.
  const onWheel = useEffectEvent((event: WheelEvent) => {
    event.preventDefault();
    const rowsPerUnit = [1 / ROW, 1, viewportRows][event.deltaMode] ?? 1 / ROW;
    moveTo(position.top + event.deltaY * rowsPerUnit);
  });
  useEffect(() => {
    const element = scroller.current;
    if (!element || !scaled) return;
    const listener = (event: WheelEvent) => onWheel(event);
    element.addEventListener("wheel", listener, { passive: false });
    return () => element.removeEventListener("wheel", listener);
    // onWheel keeps its identity; it is listed only because
    // eslint-plugin-react-hooks 5 does not know useEffectEvent.
  }, [scaled, onWheel]);

  function onScroll() {
    const scrollTop = scroller.current?.scrollTop ?? 0;
    setPosition((previous) =>
      Math.abs(scrollTop - written.current) < 1
        ? { top: previous.top, scrollTop }
        : { top: topFor(scrollTop), scrollTop },
    );
  }

  const top = Math.min(position.top, maxTop);
  const start = Math.max(0, Math.floor(top) - OVERSCAN);
  const end = Math.min(count, Math.ceil(top + viewportRows) + OVERSCAN);

  useEffect(() => {
    onRangeChange?.(start, end);
  }, [start, end, onRangeChange]);

  const minWidth = contentMinWidth;
  const grid = role === "grid";
  const rows: ReactNode[] = [];
  for (let index = start; index < end; index++) {
    rows.push(
      <div
        key={index}
        className="vlist-row"
        role={grid ? "row" : undefined}
        aria-rowindex={grid ? index + 1 + headerRows : undefined}
        style={{ top: position.scrollTop + (index - top) * ROW, minWidth }}
      >
        {renderRow(index)}
      </div>,
    );
  }

  return (
    <div
      ref={scroller}
      className="vlist"
      role={role}
      aria-label={label}
      aria-rowcount={grid ? count + headerRows : undefined}
      onScroll={onScroll}
    >
      {header !== undefined && (
        <div
          className="vlist-header"
          role={grid ? "row" : undefined}
          aria-rowindex={grid ? 1 : undefined}
          style={{ minWidth }}
        >
          {header}
        </div>
      )}
      <div className="vlist-body" style={{ height: spacer, minWidth }}>
        {rows}
      </div>
    </div>
  );
}
