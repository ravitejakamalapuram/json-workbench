import { useEffect, useState } from "react";
import type { AppState } from "../../platform/types";
import { useAppStoreApi } from "../../store";
import {
  loadReviewState,
  markReviewPrompted,
  recordReviewEvent,
  REVIEW_LARGE_DOCUMENT_BYTES,
  REVIEW_URL,
  saveReviewState,
  shouldShowReviewPrompt,
  type ReviewEvent,
  type ReviewPromptState,
} from "../review-prompt";
import { Button } from "../ui/Button";

const busy = (state: AppState) =>
  state.transformRun.kind === "running" ||
  state.docs.some(
    (doc) => doc.status.kind === "loading" || doc.status.kind === "indexing",
  );

/**
 * The one-time review nudge (app/review-prompt.ts). It watches the store for a
 * large document reaching ready and a transform run reaching done, and waits
 * until nothing is loading or running before it asks.
 */
export function ReviewNudge() {
  const store = useAppStoreApi();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let progress: ReviewPromptState | null = null;
    let asked = false;

    function askIfDue(state: AppState) {
      if (asked || !progress || !shouldShowReviewPrompt(progress, busy(state)))
        return;
      asked = true;
      setShown(true);
      void saveReviewState(markReviewPrompted(progress));
    }

    // Read and written through each time, so nothing stale is written back
    // after Settings clears local data.
    async function record(event: ReviewEvent) {
      progress = recordReviewEvent(await loadReviewState(), event);
      await saveReviewState(progress);
      askIfDue(store.getState());
    }

    return store.subscribe((state, before) => {
      for (const doc of state.docs) {
        const was = before.docs.find((d) => d.id === doc.id)?.status.kind;
        if (
          doc.status.kind === "ready" &&
          was !== "ready" &&
          doc.bytes > REVIEW_LARGE_DOCUMENT_BYTES
        )
          void record({ type: "parse-success", bytes: doc.bytes });
      }
      if (
        state.transformRun.kind === "done" &&
        before.transformRun.kind !== "done"
      )
        void record({ type: "pipeline-success" });
      askIfDue(state);
    });
  }, [store]);

  if (!shown) return null;
  return (
    <aside className="review-nudge" aria-label="Review">
      <p>Finding JSON Workbench useful? A short review helps others find it.</p>
      <a
        className="button button-text"
        href={REVIEW_URL}
        target="_blank"
        rel="noreferrer"
        onClick={() => setShown(false)}
      >
        Write a review
      </a>
      <Button onClick={() => setShown(false)}>Not now</Button>
    </aside>
  );
}
