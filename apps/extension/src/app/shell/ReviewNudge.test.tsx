// @vitest-environment happy-dom
import { act, cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearStored, readStored } from "../../platform/storage";
import { fakeOpenIndex } from "../../testing/fixtures";
import { createTestStore, renderWithStore } from "../../testing/render";
import {
  REVIEW_LARGE_DOCUMENT_BYTES,
  REVIEW_STORAGE_KEY,
  REVIEW_URL,
} from "../review-prompt";
import { ReviewNudge } from "./ReviewNudge";

beforeEach(() => clearStored());
afterEach(cleanup);

const READY = {
  kind: "ready",
  summary: { records: 0, nodes: 1 },
} as const;

function setup() {
  const { openIndex, opens } = fakeOpenIndex();
  const store = createTestStore({ openIndex });
  renderWithStore(<ReviewNudge />, { store });
  const open = (name: string, bytes: number) =>
    act(() => {
      store.getState().openDocument({
        name,
        origin: "file",
        source: new Blob([new Uint8Array(bytes)]),
        format: "json",
      });
    });
  return { store, opens, open };
}

const nudge = () => screen.queryByRole("link", { name: "Write a review" });

/** Resolves once the large document has been recorded in storage. */
const recorded = () =>
  vi.waitFor(async () =>
    expect((await readStored(REVIEW_STORAGE_KEY))?.largeDocumentParsed).toBe(
      true,
    ),
  );

describe("ReviewNudge", () => {
  it("asks once a large document parses, after nothing is in flight", async () => {
    const { opens, open } = setup();
    open("big.json", REVIEW_LARGE_DOCUMENT_BYTES + 1);
    open("other.json", 10);
    act(() => opens[0]?.settle(READY));
    // Still indexing the other document: not now.
    await recorded();
    expect(nudge()).toBeNull();
    act(() => opens[1]?.settle(READY));
    expect(
      (
        await screen.findByRole("link", { name: "Write a review" })
      ).getAttribute("href"),
    ).toBe(REVIEW_URL);
    expect(await readStored(REVIEW_STORAGE_KEY)).toEqual({
      successfulRuns: 0,
      largeDocumentParsed: true,
      prompted: true,
    });
  });

  it("stays quiet for small documents", async () => {
    const { opens, open } = setup();
    open("small.json", 10);
    act(() => opens[0]?.settle(READY));
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(nudge()).toBeNull();
    expect(await readStored(REVIEW_STORAGE_KEY)).toBeUndefined();
  });

  it("never asks a second time", async () => {
    const first = setup();
    first.open("big.json", REVIEW_LARGE_DOCUMENT_BYTES + 1);
    act(() => first.opens[0]?.settle(READY));
    await userEvent.click(
      await screen.findByRole("button", { name: "Not now" }),
    );
    expect(nudge()).toBeNull();
    cleanup();
    const second = setup();
    second.open("big.json", REVIEW_LARGE_DOCUMENT_BYTES + 1);
    act(() => second.opens[0]?.settle(READY));
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(nudge()).toBeNull();
  });
});
