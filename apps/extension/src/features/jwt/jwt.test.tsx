// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { describe, expect, it } from "vitest";
import { jwtMode } from ".";

describe("jwt stub", () => {
  it("mounts the mode", async () => {
    render(
      <Suspense fallback={null}>
        <jwtMode.Component />
      </Suspense>,
    );
    expect(await screen.findByTestId("stub-jwt")).toBeDefined();
  });
});
