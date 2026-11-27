// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OverflowMenu } from "./OverflowMenu";

afterEach(cleanup);

function setup() {
  const format = vi.fn();
  const minify = vi.fn();
  const user = userEvent.setup();
  render(
    <>
      <OverflowMenu
        items={[
          { id: "format", label: "Format", onSelect: format },
          { id: "minify", label: "Minify", onSelect: minify },
        ]}
      />
      <p>elsewhere</p>
    </>,
  );
  const more = screen.getByRole("button", { name: "More" });
  return { user, more, format, minify };
}

const focused = () => document.activeElement?.textContent;

describe("OverflowMenu", () => {
  it("moves through its items with the arrow keys and runs one with Enter", async () => {
    const { user, more, minify } = setup();
    expect(more.getAttribute("aria-expanded")).toBe("false");
    await user.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(focused()).toBe("Format");
    await user.keyboard("{ArrowDown}");
    expect(focused()).toBe("Minify");
    await user.keyboard("{ArrowDown}");
    expect(focused()).toBe("Format");
    await user.keyboard("{ArrowUp}{Enter}");
    expect(minify).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it("closes on a click elsewhere and on Tab", async () => {
    const { user, more } = setup();
    await user.click(more);
    await user.click(screen.getByText("elsewhere"));
    expect(screen.queryByRole("menu")).toBeNull();
    await user.click(more);
    await user.tab();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("renders nothing without items", () => {
    const { container } = render(<OverflowMenu items={[]} />);
    expect(container.textContent).toBe("");
  });
});
