import type { ViewProps } from "../../platform/types";
import { Breadcrumbs } from "./Breadcrumbs";
import { useTreeState } from "./tree-state";

/**
 * The bar under the tree: the selected path, and why Expand all stopped short.
 * The status element is always mounted, so a screen reader hears the text
 * when it arrives.
 */
export function TreeStatus({ doc }: ViewProps) {
  const notice = useTreeState((state) => state.notice);
  return (
    <>
      <Breadcrumbs doc={doc} />
      <span role="status" className="tree-notice">
        {notice}
      </span>
    </>
  );
}
