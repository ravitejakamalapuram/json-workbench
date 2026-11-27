// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Kbd, shortcutLabel } from "./Kbd";

afterEach(cleanup);

describe("Button", () => {
  it("is a plain button, so it never submits a form by accident", () => {
    render(<Button>Format</Button>);
    expect(
      screen.getByRole("button", { name: "Format" }).getAttribute("type"),
    ).toBe("button");
  });

  it("marks the one primary action", () => {
    render(
      <>
        <Button variant="primary">Export</Button>
        <Button>Format</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Export" }).className).toContain(
      "button-primary",
    );
    expect(screen.getByRole("button", { name: "Format" }).className).toContain(
      "button-text",
    );
  });
});

describe("Badge", () => {
  it("is text by default and a button when it acts", async () => {
    const onClick = vi.fn();
    render(
      <>
        <Badge tone="warn">String here, number elsewhere</Badge>
        <Badge tone="info" onClick={onClick}>
          Decode JWT
        </Badge>
      </>,
    );
    expect(screen.queryByRole("button", { name: /String here/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Decode JWT" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("Kbd", () => {
  it("spells a canonical shortcut the way each platform writes it", () => {
    expect(shortcutLabel("Mod+K", false)).toBe("Ctrl K");
    expect(shortcutLabel("Mod+Shift+F", true)).toBe("⌘⇧F");
    expect(shortcutLabel("Alt+ArrowUp", false)).toBe("Alt ↑");
    expect(shortcutLabel("?", true)).toBe("?");
  });

  it("renders a kbd element", () => {
    render(<Kbd shortcut="?" />);
    expect(screen.getByText("?").tagName).toBe("KBD");
  });
});
