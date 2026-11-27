// @vitest-environment happy-dom
import { act, cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "../../platform/types";
import {
  createTestStore,
  openText,
  renderWithStore,
} from "../../testing/render";
import { DetailsPanel } from "./DetailsPanel";

// No global Worker in tests: the shell's worker runs its real handlers in-process.
vi.mock("../export/spawn", async () => {
  const { fakeWorker } = await import("../../testing/fake-worker");
  const { exportHandlers } = await import("../export/export-ops");
  return { spawnExportWorker: () => fakeWorker(exportHandlers) };
});

afterEach(cleanup);

describe("DetailsPanel Copy value", () => {
  it("copies a string too long to preview as its text, like a short one", async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    const long = "x".repeat(LIMITS.previewChars);
    const doc = await openText(store, `{"long":"${long} \\"q\\" \\u00e9"}`);
    act(() => store.getState().select({ docId: doc.id, pointer: "/long" }));
    renderWithStore(<DetailsPanel doc={doc} view="tree" overlay={false} />, {
      store,
    });
    await user.click(screen.getByRole("button", { name: "Copy value" }));
    expect(await screen.findByText("Value copied.")).toBeDefined();
    expect(await navigator.clipboard.readText()).toBe(`${long} "q" é`);
  });
});
