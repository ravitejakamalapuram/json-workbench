// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { describe, expect, it } from "vitest";
import { transformMode } from ".";

describe("transform stub", () => {
  it("mounts the mode", async () => {
    render(
      <Suspense fallback={null}>
        <transformMode.Component />
      </Suspense>,
    );
    expect(await screen.findByTestId("stub-transform")).toBeDefined();
  });
});
