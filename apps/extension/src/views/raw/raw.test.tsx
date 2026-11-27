// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { describe, expect, it } from "vitest";
import { documentFixture } from "../../testing/fixtures";
import { rawProblemDetails, rawView } from ".";

describe("raw stub", () => {
  it("mounts every registered component", async () => {
    const doc = documentFixture();
    render(
      <Suspense fallback={null}>
        <rawView.Component doc={doc} />
        <rawProblemDetails.Component doc={doc} />
      </Suspense>,
    );
    expect(await screen.findByTestId("stub-raw")).toBeDefined();
    expect(await screen.findByTestId("stub-raw-problem")).toBeDefined();
  });
});
