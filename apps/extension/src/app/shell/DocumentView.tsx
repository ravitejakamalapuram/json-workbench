import { Suspense } from "react";
import type { DocumentModel, ViewId } from "../../platform/types";
import { useAppStore, useAppStoreApi } from "../../store";
import { actionsFor, runAction } from "../actions";
import { registry } from "../registry";
import { useActionList } from "../ui/actions-context";
import { Button } from "../ui/Button";
import { Tabs, type TabItem } from "../ui/Tabs";
import { DetailsPanel } from "./DetailsPanel";
import { statusLabel } from "./format";
import { Loading } from "./Loading";
import { OverflowMenu, type MenuItem } from "./OverflowMenu";
import { useWidth } from "./use-width";

const PANEL_ID = "view-panel";

/** The active document: toolbar (view tabs, status, view controls), the view, its details and the view's status bar. */
export function DocumentView({ doc }: { readonly doc: DocumentModel }) {
  const view = useAppStore((state) => state.view);
  const setView = useAppStore((state) => state.setView);
  const detailsOpen = useAppStore((state) => state.detailsOpen);
  const width = useWidth();

  const tabs = registry.views.map((plugin): TabItem<ViewId> => {
    const supported = plugin.supports(doc);
    return {
      id: plugin.id,
      label: plugin.label,
      ...(supported !== true && { disabled: supported }),
    };
  });
  // A view the document does not support falls back to the first that does
  // (the tree supports every document).
  const shown =
    registry.views.find((p) => p.id === view && p.supports(doc) === true) ??
    registry.views.find((p) => p.supports(doc) === true);

  return (
    <div className="document">
      <div className="toolbar">
        <Tabs
          label="Views"
          tabs={tabs}
          selected={shown?.id ?? view}
          onSelect={setView}
          panelId={PANEL_ID}
        />
        <DocStatus doc={doc} />
        <div className="toolbar-end">
          {shown?.Toolbar && (
            <Suspense fallback={null}>
              <shown.Toolbar doc={doc} />
            </Suspense>
          )}
          <ToolbarActions doc={doc} compact={width !== "wide"} />
        </div>
      </div>
      <div className="document-body">
        <div
          role="tabpanel"
          id={PANEL_ID}
          aria-labelledby={shown && `${PANEL_ID}-tab-${shown.id}`}
          className="view-panel"
        >
          {shown && (
            <Suspense fallback={<Loading />}>
              {/* Keyed by document, so a view starts fresh on another tab. */}
              <shown.Component key={doc.id} doc={doc} />
            </Suspense>
          )}
        </div>
        {detailsOpen && shown && (
          <DetailsPanel
            doc={doc}
            view={shown.id}
            overlay={width === "narrow"}
          />
        )}
      </div>
      {/* Always present in view mode, so the layout does not jump when a view has nothing to say. */}
      <div className="status-bar" data-testid="view-status-bar">
        {shown?.StatusBar && (
          <Suspense fallback={null}>
            <shown.StatusBar key={doc.id} doc={doc} />
          </Suspense>
        )}
      </div>
    </div>
  );
}

function DocStatus({ doc }: { readonly doc: DocumentModel }) {
  const store = useAppStoreApi();
  const actions = useActionList();
  const cancelIndexing = useAppStore((state) => state.cancelIndexing);
  const { tone, text, detail } = statusLabel(doc);
  const { status } = doc;
  const open = actions.find((action) => action.id === "app.open");
  return (
    <div className="doc-status">
      <p data-testid="shell-status" role="status" className={`status-${tone}`}>
        {tone !== "muted" && <span aria-hidden="true">● </span>}
        {text}
        {detail && <span className="muted"> · {detail}</span>}
      </p>
      {status.kind === "indexing" && (
        <>
          <progress
            aria-label="Indexing progress"
            value={status.progress.indexedBytes}
            max={status.progress.totalBytes || 1}
          />
          <Button onClick={() => cancelIndexing(doc.id)}>Cancel</Button>
        </>
      )}
      {/* A browser gives a page no way to read a file again: choosing it again is the only way back. */}
      {status.kind === "failed" && doc.origin === "file" && open && (
        <Button
          onClick={() =>
            void runAction(open, {
              state: store.getState(),
              doc,
              node: undefined,
            })
          }
        >
          Reopen file
        </Button>
      )}
    </div>
  );
}

type ToolbarActionsProps = {
  readonly doc: DocumentModel;
  /** Up to 1100 px the secondary controls go into More, so the toolbar does not crowd. */
  readonly compact: boolean;
};

/** Registry actions placed on the toolbar and the details toggle; the one primary (Export) comes last. */
function ToolbarActions({ doc, compact }: ToolbarActionsProps) {
  const store = useAppStoreApi();
  const actions = useActionList();
  const detailsOpen = useAppStore((state) => state.detailsOpen);
  const setDetailsOpen = useAppStore((state) => state.setDetailsOpen);
  const context = () => ({ state: store.getState(), doc, node: undefined });
  const offered = actionsFor(actions, context(), "toolbar");
  const secondary: MenuItem[] = [
    ...offered
      .filter((action) => !action.primary)
      .map((action) => ({
        id: action.id,
        label: action.label,
        onSelect: () => void runAction(action, context()),
      })),
    {
      id: "details",
      label: detailsOpen ? "Hide details" : "Show details",
      onSelect: () => setDetailsOpen(!detailsOpen),
    },
  ];
  return (
    <>
      {compact ? (
        <OverflowMenu items={secondary} />
      ) : (
        secondary.map((item) => (
          <Button key={item.id} onClick={item.onSelect}>
            {item.label}
          </Button>
        ))
      )}
      {offered
        .filter((action) => action.primary)
        .map((action) => (
          <Button
            key={action.id}
            variant="primary"
            onClick={() => void runAction(action, context())}
          >
            {action.label}
          </Button>
        ))}
    </>
  );
}
