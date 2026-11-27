import { lazy, useState } from "react";
import { useAppStore } from "../../store";
import type { ViewProps } from "../../platform/types";
import { isPaged } from "./paged";
import ProblemBar from "./ProblemBar";

// Two chunks, so a large document never loads CodeMirror (ADR 0004).
const RawEditor = lazy(() => import("./RawEditor"));
const RawPager = lazy(() => import("./RawPager"));

/** The editor up to LIMITS.rawEditChars, the read-only pager above it. */
export default function RawView({ doc }: ViewProps) {
  const [paged] = useState(() => isPaged(doc));
  // The details panel shows the full Problem block when it is open; showing
  // the bar too would say everything twice.
  const detailsOpen = useAppStore((state) => state.detailsOpen);
  return (
    <div className="raw-view">
      {!detailsOpen && <ProblemBar doc={doc} />}
      <div className="raw-view-body">
        {paged ? <RawPager doc={doc} /> : <RawEditor doc={doc} />}
      </div>
    </div>
  );
}
