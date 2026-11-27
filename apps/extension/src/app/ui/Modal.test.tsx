// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Modal } from "./Modal";

afterEach(cleanup);

function Page({ nested = false }: { readonly nested?: boolean }) {
  const [open, setOpen] = useState(false);
  const [inner, setInner] = useState(false);
  return (
    <main>
      <button type="button" onClick={() => setOpen(true)}>
        Settings
      </button>
      {open && (
        <Modal title="Settings" onClose={() => setOpen(false)}>
          <input aria-label="Name" />
          {nested && (
            <button type="button" onClick={() => setInner(true)}>
              Clear local data
            </button>
          )}
          {inner && (
            <Modal title="Confirm" onClose={() => setInner(false)}>
              <button type="button">Clear</button>
            </Modal>
          )}
        </Modal>
      )}
    </main>
  );
}

/** The element `render` mounted the page in: the app root, a child of body. */
function appRoot() {
  return screen.getByRole("main").parentElement as HTMLElement;
}

describe("Modal", () => {
  it("is a labelled dialog that takes focus", async () => {
    render(<Page />);
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("makes the page behind inert while open and restores it after", async () => {
    render(<Page />);
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(appRoot().hasAttribute("inert")).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(appRoot().hasAttribute("inert")).toBe(false);
  });

  it("returns focus to the opener on close", async () => {
    render(<Page />);
    const opener = screen.getByRole("button", { name: "Settings" });
    await userEvent.click(opener);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(document.activeElement).toBe(opener);
  });

  it("keeps Tab inside the dialog", async () => {
    render(<Page />);
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    const close = screen.getByRole("button", { name: "Close" });
    const name = screen.getByRole("textbox", { name: "Name" });
    name.focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(close);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(name);
  });

  it("makes the dialog below a nested one inert, and only undoes its own", async () => {
    render(<Page nested />);
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Clear local data" }),
    );
    const outer = screen
      .getByRole("dialog", { hidden: true, name: "Settings" })
      .closest(".overlay") as HTMLElement;
    expect(outer.hasAttribute("inert")).toBe(true);
    expect(screen.getByRole("dialog", { name: "Confirm" })).toBeDefined();

    await userEvent.keyboard("{Escape}");
    expect(outer.hasAttribute("inert")).toBe(false);
    expect(appRoot().hasAttribute("inert")).toBe(true);
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeDefined();
  });
});
