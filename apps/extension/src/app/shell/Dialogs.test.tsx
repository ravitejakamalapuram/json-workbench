// @vitest-environment happy-dom
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Action } from "../../platform/types";
import { renderWithStore } from "../../testing/render";
import { ActionsContext } from "../ui/actions-context";
import { Dialogs } from "./Dialogs";
import { closeDialog, openDialog } from "./session";

afterEach(() => {
  closeDialog();
  cleanup();
});

const action = (
  id: Action["id"],
  shortcut: string,
  when?: Action["when"],
): Action => ({
  id,
  label: `Do ${id}`,
  shortcut,
  placement: ["palette"],
  run: () => undefined,
  ...(when && { when }),
});

describe("the shortcuts dialog", () => {
  it("lists only the shortcuts that work in the current context", () => {
    renderWithStore(
      <ActionsContext.Provider
        value={[
          action("app.here", "Alt+H"),
          action("app.gone", "Alt+G", () => false),
        ]}
      >
        <Dialogs openFile={() => undefined} />
      </ActionsContext.Provider>,
    );
    act(() => openDialog({ kind: "help" }));
    expect(screen.getByText("Do app.here")).toBeDefined();
    expect(screen.queryByText("Do app.gone")).toBeNull();
    expect(screen.getByText("Paste JSON")).toBeDefined();
  });
});
