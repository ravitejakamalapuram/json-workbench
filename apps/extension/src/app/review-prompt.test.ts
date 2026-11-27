import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeChrome } from "../testing/fake-chrome";
import {
  REVIEW_LARGE_DOCUMENT_BYTES,
  REVIEW_STORAGE_KEY,
  REVIEW_URL,
  initialReviewState,
  isReviewPromptEligible,
  loadReviewState,
  markReviewPrompted,
  mergeReviewStates,
  normalizeReviewState,
  recordReviewEvent,
  saveReviewState,
  shouldShowReviewPrompt,
  type ReviewPromptState,
} from "./review-prompt";

const run = (state: ReviewPromptState, times: number) => {
  let next = state;
  for (let index = 0; index < times; index++)
    next = recordReviewEvent(next, { type: "pipeline-success" });
  return next;
};

describe("review prompt trigger", () => {
  it("points at the Chrome Web Store reviews page", () => {
    expect(REVIEW_URL).toBe(
      "https://chromewebstore.google.com/detail/higmlhleblpmdogjccpmjlnilpmhohal/reviews",
    );
  });

  it("becomes eligible after three successful pipeline runs", () => {
    expect(isReviewPromptEligible(run(initialReviewState, 2))).toBe(false);
    expect(isReviewPromptEligible(run(initialReviewState, 3))).toBe(true);
  });

  it("becomes eligible after one clean parse of a document over 10 MB", () => {
    const small = recordReviewEvent(initialReviewState, {
      type: "parse-success",
      bytes: REVIEW_LARGE_DOCUMENT_BYTES,
    });
    expect(isReviewPromptEligible(small)).toBe(false);
    const large = recordReviewEvent(initialReviewState, {
      type: "parse-success",
      bytes: REVIEW_LARGE_DOCUMENT_BYTES + 1,
    });
    expect(isReviewPromptEligible(large)).toBe(true);
  });

  it("never shows while work is in flight", () => {
    const eligible = run(initialReviewState, 3);
    expect(shouldShowReviewPrompt(eligible, true)).toBe(false);
    expect(shouldShowReviewPrompt(eligible, false)).toBe(true);
  });

  it("shows only once", () => {
    const shown = markReviewPrompted(run(initialReviewState, 3));
    expect(shouldShowReviewPrompt(shown, false)).toBe(false);
    expect(shouldShowReviewPrompt(run(shown, 10), false)).toBe(false);
  });

  it("merges persisted progress with events recorded before load", () => {
    expect(
      mergeReviewStates(
        { successfulRuns: 2, largeDocumentParsed: false, prompted: false },
        { successfulRuns: 1, largeDocumentParsed: false, prompted: false },
      ),
    ).toEqual({
      successfulRuns: 3,
      largeDocumentParsed: false,
      prompted: false,
    });
    expect(
      mergeReviewStates(
        { successfulRuns: 0, largeDocumentParsed: false, prompted: true },
        initialReviewState,
      ).prompted,
    ).toBe(true);
  });

  it("normalizes malformed stored values", () => {
    expect(normalizeReviewState(undefined)).toEqual(initialReviewState);
    expect(normalizeReviewState("nope")).toEqual(initialReviewState);
    expect(
      normalizeReviewState({
        successfulRuns: -4,
        largeDocumentParsed: "yes",
        prompted: true,
      }),
    ).toEqual({
      successfulRuns: 0,
      largeDocumentParsed: false,
      prompted: true,
    });
  });
});

describe("review prompt persistence", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("round-trips state through chrome.storage.local", async () => {
    const chrome = installFakeChrome();
    const state = markReviewPrompted(run(initialReviewState, 3));
    await saveReviewState(state);
    expect(chrome.storage.local.data.get(REVIEW_STORAGE_KEY)).toEqual(state);
    expect(await loadReviewState()).toEqual(state);
  });

  it("falls back to the initial state when storage fails", async () => {
    const chrome = installFakeChrome();
    chrome.storage.local.get.mockRejectedValueOnce(new Error("unavailable"));
    chrome.storage.local.set.mockRejectedValueOnce(new Error("unavailable"));
    expect(await loadReviewState()).toEqual(initialReviewState);
    await expect(saveReviewState(initialReviewState)).resolves.toBeUndefined();
  });
});
