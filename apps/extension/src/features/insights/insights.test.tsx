// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { describe, expect, it } from "vitest";
import { documentFixture } from "../../testing/fixtures";
import { insightsDetails } from ".";

describe("insights stub", () => {
  it("mounts every registered component", async () => {
    const doc = documentFixture();
    render(
      <Suspense fallback={null}>
        <insightsDetails.Component doc={doc} />
      </Suspense>,
    );
    expect(await screen.findByTestId("stub-insights")).toBeDefined();
  });
});
