// @vitest-environment happy-dom
import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearStored, readStored, writeStored } from "../../platform/storage";
import { createTestStore, renderWithStore } from "../../testing/render";
import { REVIEW_STORAGE_KEY } from "../review-prompt";
import { SettingsDialog } from "./SettingsDialog";

beforeEach(() => clearStored());
afterEach(cleanup);

const recent = { name: "orders.json", bytes: 2048, openedAt: Date.now() };

function setup() {
  const store = createTestStore();
  act(() => store.getState().addRecent(recent));
  const onClose = vi.fn();
  const user = userEvent.setup();
  renderWithStore(<SettingsDialog onClose={onClose} />, { store });
  const dialog = within(screen.getByRole("dialog", { name: "Settings" }));
  return { store, user, dialog, onClose };
}

describe("SettingsDialog", () => {
  it("switches the theme, light first", async () => {
    const { store, user, dialog } = setup();
    expect(
      dialog.getByRole("radio", { name: "Light", checked: true }),
    ).toBeDefined();
    await user.click(dialog.getByRole("radio", { name: "Dark" }));
    expect(store.getState().theme).toBe("dark");
    expect(await readStored("jwb.theme")).toBe("dark");
  });

  it("sets the memory limit for whole-document work", async () => {
    const { store, user, dialog } = setup();
    const limit = dialog.getByRole("combobox", { name: "Memory limit" });
    expect((limit as HTMLSelectElement).value).toBe("64");
    await user.selectOptions(limit, "128 MB");
    expect(store.getState().materializeLimitMb).toBe(128);
  });

  it("lists recent files and clears them", async () => {
    const { store, user, dialog } = setup();
    const list = within(dialog.getByRole("region", { name: "Recent files" }));
    expect(list.getByText("orders.json")).toBeDefined();
    expect(list.getByText(/2 KB · today/)).toBeDefined();
    await user.click(list.getByRole("button", { name: "Clear recent files" }));
    expect(store.getState().recents).toEqual([]);
    expect(list.getByText("No recent files.")).toBeDefined();
    expect(
      list
        .getByRole("button", { name: "Clear recent files" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("clears local data: every stored key, and the live settings", async () => {
    const { store, user, dialog } = setup();
    await user.click(dialog.getByRole("radio", { name: "Dark" }));
    await writeStored(REVIEW_STORAGE_KEY, {
      successfulRuns: 1,
      largeDocumentParsed: false,
      prompted: true,
    });
    await user.click(dialog.getByRole("button", { name: "Clear local data" }));
    expect(await dialog.findByText("Local data cleared.")).toBeDefined();
    expect(store.getState().theme).toBe("light");
    expect(store.getState().recents).toEqual([]);
    expect(await readStored("jwb.theme")).toBeUndefined();
    expect(await readStored("jwb.recents")).toBeUndefined();
    expect(await readStored(REVIEW_STORAGE_KEY)).toBeUndefined();
    expect(
      dialog.getByRole("radio", { name: "Light", checked: true }),
    ).toBeDefined();
  });

  it("closes with Close", async () => {
    const { user, dialog, onClose } = setup();
    await user.click(dialog.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
