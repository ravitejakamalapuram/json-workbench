// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Shell } from "./Shell";

describe("shell stub", () => {
  it("mounts", () => {
    render(<Shell />);
    expect(screen.getByTestId("stub-shell")).toBeDefined();
  });
});
