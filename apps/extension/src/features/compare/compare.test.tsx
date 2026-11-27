// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { describe, expect, it } from "vitest";
import { compareMode } from ".";

describe("compare stub", () => {
  it("mounts the mode", async () => {
    render(
      <Suspense fallback={null}>
        <compareMode.Component />
      </Suspense>,
    );
    expect(await screen.findByTestId("stub-compare")).toBeDefined();
  });
});
