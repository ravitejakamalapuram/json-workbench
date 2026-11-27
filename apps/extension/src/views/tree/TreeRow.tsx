import type { CSSProperties, MouseEvent, Ref } from "react";
import type { Action, Marker, NodeInfo } from "../../platform/types";
import { expandable, type EmbeddedState, type Row } from "./tree-model";

type TreeRowProps = {
  readonly row: Row;
  readonly selected: boolean;
  /** The one row in the tab order (roving focus); its badges are reachable with Tab. */
  readonly tabStop: boolean;
  readonly focusRef: Ref<HTMLDivElement> | undefined;
  readonly markers: readonly Marker[] | undefined;
  readonly actions: readonly Action[];
  readonly embedded: EmbeddedState | undefined;
  readonly onSelect: (row: Row) => void;
  readonly onToggle: (row: Row) => void;
  readonly onAction: (row: Row, action: Action) => void;
  readonly onOpenAsDocument: (row: Row) => void;
};

const BRACKETS = { object: ["{", "}"], array: ["[", "]"] } as const;

/** A key as written in JSON: member names quoted, array positions bare. */
function keyText(key: NodeInfo["key"]): string | null {
  if (key === null) return null;
  return typeof key === "number" ? String(key) : JSON.stringify(key);
}

/** Strings as they read in the source, escapes and all; a cut preview ends in "…". */
function valueText({ kind, text = "", truncated }: NodeInfo): string {
  if (kind !== "string") return text;
  const quoted = JSON.stringify(text);
  return truncated ? `${quoted.slice(0, -1)}…` : quoted;
}

function countText(node: NodeInfo, row: Row): string {
  const brackets = node.kind === "object" ? BRACKETS.object : BRACKETS.array;
  const count = row.open?.total ?? node.childCount;
  const more = row.open && !row.open.final ? "+" : "";
  const shown = count === undefined ? "…" : count.toLocaleString("en-US");
  return `${brackets[0]}${shown}${more}${brackets[1]}`;
}

/** One 28 px row. JSON reaches the DOM only as React text. */
export function TreeRow({
  row,
  selected,
  tabStop,
  focusRef,
  markers,
  actions,
  embedded,
  onSelect,
  onToggle,
  onAction,
  onOpenAsDocument,
}: TreeRowProps) {
  const { node, path } = row;
  const level = path.length + 1;
  const common = {
    role: "treeitem",
    "data-testid": "tree-row",
    "aria-level": level,
    "aria-setsize": row.setSize,
    "aria-posinset": (path.at(-1) ?? 0) + 1,
    className: "tree-row",
    style: { "--level": level - 1 } as CSSProperties,
  } as const;
  if (!node)
    return (
      <div {...common} aria-busy="true" tabIndex={-1}>
        <span className="tree-null">…</span>
      </div>
    );

  const container = node.kind === "object" || node.kind === "array";
  const canExpand = expandable(node);
  const key = keyText(node.key);
  const badgeTab = tabStop ? 0 : -1;
  const stop = (event: MouseEvent) => event.stopPropagation();
  return (
    <div
      {...common}
      ref={focusRef}
      data-pointer={node.pointer}
      aria-expanded={canExpand ? row.open !== undefined : undefined}
      aria-selected={selected}
      tabIndex={tabStop ? 0 : -1}
      onClick={() => onSelect(row)}
    >
      {canExpand && (
        <span
          className="tree-toggle"
          data-open={row.open ? "" : undefined}
          aria-hidden="true"
          onClick={(event) => {
            stop(event);
            onSelect(row);
            onToggle(row);
          }}
        />
      )}
      {key !== null && <span className="tree-key">{key}</span>}
      {container ? (
        <span className="tree-null">{countText(node, row)}</span>
      ) : (
        <>
          {key !== null && <span className="tree-null">:</span>}
          <span className={`tree-value tree-${node.kind}`}>
            {valueText(node)}
          </span>
        </>
      )}
      {markers?.[0] && (
        <span
          className={`badge badge-${markers[0].severity === "error" ? "danger" : "warn"}`}
        >
          {markers[0].message}
        </span>
      )}
      {markers && markers.length > 1 && (
        <span className="tree-note">+{markers.length - 1}</span>
      )}
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className="badge badge-info"
          tabIndex={badgeTab}
          onClick={(event) => {
            stop(event);
            // Expand JSON removes its own badge; without this the keyboard
            // user's focus would fall to the page.
            event.currentTarget
              .closest<HTMLElement>("[role=treeitem]")
              ?.focus();
            onAction(row, action);
          }}
        >
          {action.label}
        </button>
      ))}
      {embedded?.kind === "expanding" && (
        <span className="tree-note">Expanding…</span>
      )}
      {embedded?.kind === "failed" && (
        <>
          <span className="badge badge-danger">{embedded.message}</span>
          {embedded.tooLarge && (
            <button
              type="button"
              className="badge badge-info"
              tabIndex={badgeTab}
              onClick={(event) => {
                stop(event);
                onOpenAsDocument(row);
              }}
            >
              Open as document
            </button>
          )}
        </>
      )}
    </div>
  );
}
