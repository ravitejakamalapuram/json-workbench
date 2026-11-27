import { lazy, useState } from "react";
import type { ViewProps } from "../../platform/types";
import { isPaged } from "./paged";

// Two chunks, so a large document never loads CodeMirror (ADR 0004).
const RawEditor = lazy(() => import("./RawEditor"));
const RawPager = lazy(() => import("./RawPager"));

/** The editor up to LIMITS.rawEditChars, the read-only pager above it. */
export default function RawView({ doc }: ViewProps) {
  const [paged] = useState(() => isPaged(doc));
  return paged ? <RawPager doc={doc} /> : <RawEditor doc={doc} />;
}
