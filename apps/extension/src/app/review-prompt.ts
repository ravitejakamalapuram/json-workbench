/**
 * One-time, non-modal "please review" nudge. The prompt becomes eligible
 * after a few successful pipeline runs or one clean parse of a large
 * document, is never shown while work is in flight, and is shown at most
 * once per install (the flag lives in chrome.storage.local).
 */

export const REVIEW_URL =
  "https://chromewebstore.google.com/detail/higmlhleblpmdogjccpmjlnilpmhohal/reviews";
export const REVIEW_STORAGE_KEY = "json-workbench:review-prompt";
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

/** Minimal promise-based subset of chrome.storage.local. */
export interface ReviewStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export async function loadReviewState(
  storage: ReviewStorageArea | undefined,
): Promise<ReviewPromptState> {
  if (!storage) return initialReviewState;
  try {
    const items = await storage.get(REVIEW_STORAGE_KEY);
    return normalizeReviewState(items[REVIEW_STORAGE_KEY]);
  } catch {
    return initialReviewState;
  }
}

export async function saveReviewState(
  storage: ReviewStorageArea | undefined,
  state: ReviewPromptState,
): Promise<void> {
  if (!storage) return;
  try {
    await storage.set({ [REVIEW_STORAGE_KEY]: { ...state } });
  } catch {
    // Storage is best-effort; the prompt is a nicety, never a blocker.
  }
}

/** Returns chrome.storage.local when running inside the extension. */
export function chromeLocalStorageArea(): ReviewStorageArea | undefined {
  const chrome = (
    globalThis as typeof globalThis & {
      chrome?: { storage?: { local?: ReviewStorageArea } };
    }
  ).chrome;
  return chrome?.storage?.local;
}
