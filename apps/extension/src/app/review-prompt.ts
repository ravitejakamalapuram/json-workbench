import { readStored, writeStored } from "../platform/storage";

/**
 * One-time, non-modal "please review" nudge. The prompt becomes eligible
 * after a few successful pipeline runs or one clean parse of a large
 * document, is never shown while work is in flight, and is shown at most
 * once per install (the flag lives in chrome.storage.local).
 */

export const REVIEW_URL =
  "https://chromewebstore.google.com/detail/higmlhleblpmdogjccpmjlnilpmhohal/reviews";
export const REVIEW_STORAGE_KEY = "json-workbench:review-prompt" as const;
export const REVIEW_RUN_THRESHOLD = 3;
export const REVIEW_LARGE_DOCUMENT_BYTES = 10 * 1024 * 1024;

export interface ReviewPromptState {
  /** Successful pipeline runs on the user's own data. */
  readonly successfulRuns: number;
  /** A document larger than the threshold parsed without error. */
  readonly largeDocumentParsed: boolean;
  /** The banner has been shown once; never show it again. */
  readonly prompted: boolean;
}

export type ReviewEvent =
  | { readonly type: "pipeline-success" }
  | { readonly type: "parse-success"; readonly bytes: number };

export const initialReviewState: ReviewPromptState = {
  successfulRuns: 0,
  largeDocumentParsed: false,
  prompted: false,
};

export function recordReviewEvent(
  state: ReviewPromptState,
  event: ReviewEvent,
): ReviewPromptState {
  if (state.prompted) return state;
  if (event.type === "pipeline-success")
    return { ...state, successfulRuns: state.successfulRuns + 1 };
  if (event.bytes > REVIEW_LARGE_DOCUMENT_BYTES && !state.largeDocumentParsed)
    return { ...state, largeDocumentParsed: true };
  return state;
}

export function isReviewPromptEligible(state: ReviewPromptState): boolean {
  return (
    !state.prompted &&
    (state.successfulRuns >= REVIEW_RUN_THRESHOLD || state.largeDocumentParsed)
  );
}

export function shouldShowReviewPrompt(
  state: ReviewPromptState,
  busy: boolean,
): boolean {
  return !busy && isReviewPromptEligible(state);
}

export function markReviewPrompted(
  state: ReviewPromptState,
): ReviewPromptState {
  return { ...state, prompted: true };
}

/** Combines persisted progress with anything recorded before it loaded. */
export function mergeReviewStates(
  stored: ReviewPromptState,
  pending: ReviewPromptState,
): ReviewPromptState {
  return {
    successfulRuns: stored.successfulRuns + pending.successfulRuns,
    largeDocumentParsed:
      stored.largeDocumentParsed || pending.largeDocumentParsed,
    prompted: stored.prompted || pending.prompted,
  };
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

export function normalizeReviewState(value: unknown): ReviewPromptState {
  if (!value || typeof value !== "object") return initialReviewState;
  const record = value as Record<string, unknown>;
  return {
    successfulRuns: asCount(record.successfulRuns),
    largeDocumentParsed: record.largeDocumentParsed === true,
    prompted: record.prompted === true,
  };
}

// Storage is best-effort: the prompt is a nicety, never a blocker.
export async function loadReviewState(): Promise<ReviewPromptState> {
  try {
    return normalizeReviewState(await readStored(REVIEW_STORAGE_KEY));
  } catch {
    return initialReviewState;
  }
}

export async function saveReviewState(state: ReviewPromptState): Promise<void> {
  try {
    await writeStored(REVIEW_STORAGE_KEY, { ...state });
  } catch {
    // Nothing to do: the nudge shows again at worst.
  }
}
