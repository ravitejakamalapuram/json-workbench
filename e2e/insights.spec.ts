import { expect, test } from "@playwright/test";
import { expectStatus, loadFixture } from "./helpers";

test.describe("insights", () => {
  test("profile metrics match the loaded dataset", async ({ page }) => {
    await loadFixture(page);
    const metrics = page.getByTestId("insights-metrics");
    await expect(metrics).toBeVisible();
    // Fixture: 3 records → 3 objects, 1 root array, 12 leaf values, depth 2.
    await expect(metrics.locator(".metric").nth(0)).toContainText("3");
    await expect(metrics.locator(".metric").nth(2)).toContainText("12");
    await expect(metrics.locator(".metric").nth(3)).toContainText("1");
  });

  test("field stats list fields with types and click-to-search", async ({
    page,
  }) => {
    await loadFixture(page);
    const fields = page.getByTestId("insights-fields");
    await expect(fields).toBeVisible();
    await expect(fields).toContainText("name");
    await expect(fields).toContainText("string");
    await fields.getByText("name", { exact: true }).click();
    await expect(page.getByPlaceholder("Search values or paths")).toHaveValue(
      "name",
    );
  });
});

test.describe("schema", () => {
  test("infer schema fills the schema input with properties", async ({
    page,
  }) => {
    await loadFixture(page);
    await page.getByTestId("infer-schema-button").click();
    const schema = page.locator(".schema-input");
    await expect(schema).toContainText('"properties"', { timeout: 15_000 });
    await expect(schema).toContainText('"id"');
    await expect(schema).toContainText('"name"');
  });

  test("validate current result passes against an inferred schema", async ({
    page,
  }) => {
    await loadFixture(page);
    await page.getByTestId("infer-schema-button").click();
    await expect(page.locator(".schema-input")).toContainText('"properties"', {
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Validate current result" }).click();
    await expectStatus(page, "Validation passed");
  });

  test("validation failures report issues with pointers", async ({ page }) => {
    await loadFixture(page);
    await page.locator(".schema-input").fill(
      JSON.stringify({
        type: "array",
        items: {
          type: "object",
          required: ["id", "email"],
          properties: { id: { type: "number" } },
        },
      }),
    );
    await page.getByRole("button", { name: "Validate current result" }).click();
    await expectStatus(page, /validation issue/);
    await expect(page.locator(".diagnostic").first()).toContainText("/0/email");
    await expect(page.locator(".diagnostic").first()).toContainText("required");
  });
});

test.describe("assistant", () => {
  test("supported prompt proposes a reviewable pipeline", async ({ page }) => {
    await loadFixture(page);
    await page
      .locator(".assistant-input")
      .fill("filter active = true and sort by id desc");
    await page.getByRole("button", { name: "Generate suggestion" }).click();
    await expect(page.locator(".assistant-result")).toContainText(
      "explicit step",
    );
    await page.getByRole("button", { name: "Review and add" }).click();
    await expect(page.locator(".steps .step")).toHaveCount(2);
    await expectStatus(page, "Suggestion added for review");
  });

  test("unsupported prompt explains itself and offers no add action", async ({
    page,
  }) => {
    await loadFixture(page);
    await page.locator(".assistant-input").fill("do a barrel roll");
    await page.getByRole("button", { name: "Generate suggestion" }).click();
    await expect(page.locator(".assistant-result")).toContainText(
      "No supported operation",
    );
    await expect(
      page.getByRole("button", { name: "Review and add" }),
    ).toHaveCount(0);
  });
});
