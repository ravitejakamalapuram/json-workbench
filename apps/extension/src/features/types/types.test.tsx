// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { describe, expect, it } from "vitest";
import { typesMode } from ".";

describe("types stub", () => {
  it("mounts the mode", async () => {
    render(
      <Suspense fallback={null}>
        <typesMode.Component />
      </Suspense>,
    );
    expect(await screen.findByTestId("stub-types")).toBeDefined();
  });
});
