import { expect, test } from "@playwright/test";
import { expectStatus, loadFixture } from "./helpers";

test.describe.configure({ mode: "serial" });

test.describe("pipeline", () => {
  test("add step appears in the pipeline list", async ({ page }) => {
    await loadFixture(page);
    await page.getByRole("button", { name: "+ Filter" }).click();
    await expect(page.locator(".steps .step")).toHaveCount(1);
    await expect(page.locator(".steps .step strong")).toContainText("filter");
  });

  test("filter step with default config runs and keeps matching rows", async ({
    page,
  }) => {
    await loadFixture(page);
    await page.getByRole("button", { name: "+ Filter" }).click();
    await page.getByRole("button", { name: "Run preview" }).click();
    await expectStatus(page, "Preview ready");
    await expect(page.locator(".viewer-card h2")).toHaveText("Pipeline result");
    // Default filter is field=id equals=1 → only the first record survives.
    await page.getByRole("button", { name: "Table" }).click();
    await expect(page.locator(".table-wrap tbody tr")).toHaveCount(1);
  });

  test("sort step with default config runs without error", async ({ page }) => {
    await loadFixture(page);
    await page.getByRole("button", { name: "+ Sort" }).click();
    await page.getByRole("button", { name: "Run preview" }).click();
    await expectStatus(page, "Preview ready");
  });

  test("sort step reorders records by key ascending then descending", async ({
    page,
  }) => {
    await loadFixture(page);
    await page.getByRole("button", { name: "+ Sort" }).click();
    await page
      .locator(".step-config")
      .fill('{ "key": "id", "direction": "asc" }');
    await page.getByRole("button", { name: "Run preview" }).click();
    await expectStatus(page, "Preview ready");
    await page.getByRole("button", { name: "Table" }).click();
    await expect(page.locator(".table-wrap tbody tr").first()).toContainText(
      "Ada",
    );

    await page
      .locator(".step-config")
      .fill('{ "key": "id", "direction": "desc" }');
    await page.getByRole("button", { name: "Run preview" }).click();
    await expectStatus(page, "Preview ready");
    await expect(page.locator(".table-wrap tbody tr").first()).toContainText(
      "Linus",
    );
  });

  test("rename step with default config runs and renames the field", async ({
    page,
  }) => {
    await loadFixture(page);
    await page.getByRole("button", { name: "+ Rename" }).click();
    await page.getByRole("button", { name: "Run preview" }).click();
    await expectStatus(page, "Preview ready");
    await page.getByRole("button", { name: "Table" }).click();
    await expect(page.locator(".table-wrap thead")).toContainText("label");
  });

  test("step can be disabled and the pipeline still runs", async ({ page }) => {
    await loadFixture(page);
    await page.getByRole("button", { name: "+ Filter" }).click();
    await page.getByRole("button", { name: "Disable step 1" }).click();
    await page.getByRole("button", { name: "Run preview" }).click();
    await expectStatus(page, "Preview ready");
    await expect(page.locator(".stats-list")).toContainText("skipped");
  });

  test("steps can be reordered, duplicated, and deleted", async ({ page }) => {
    await loadFixture(page);
    await page.getByRole("button", { name: "+ Filter" }).click();
    await page.getByRole("button", { name: "+ Add" }).click();
    await expect(page.locator(".steps .step")).toHaveCount(2);
    await page.getByRole("button", { name: "Move step 2 up" }).click();
    await expect(page.locator(".steps .step strong").first()).toContainText(
      "add",
    );
    // Two steps are on screen — duplicate the (moved) add step specifically.
    await page
      .locator(".step", { hasText: "add" })
      .first()
      .getByRole("button", { name: "Duplicate" })
      .click();
    await expect(page.locator(".steps .step")).toHaveCount(3);
    await page
      .locator(".step", { hasText: "add" })
      .first()
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(page.locator(".steps .step")).toHaveCount(2);
  });

  test("undo and redo restore pipeline edits", async ({ page }) => {
    await loadFixture(page);
    await page.getByRole("button", { name: "+ Filter" }).click();
    await page.getByRole("button", { name: "+ Add" }).click();
    await page.getByRole("button", { name: "Undo pipeline change" }).click();
    await expect(page.locator(".steps .step")).toHaveCount(1);
    await page.getByRole("button", { name: "Redo pipeline change" }).click();
    await expect(page.locator(".steps .step")).toHaveCount(2);
  });

  test("invalid step config shows a pipeline error instead of crashing", async ({
    page,
  }) => {
    await loadFixture(page);
    await page.getByRole("button", { name: "+ Filter" }).click();
    await page.locator(".step-config").fill("not-json");
    await page.locator(".step-config").blur();
    await expect(page.locator(".error-box")).toContainText(/JSON|object/i);
  });

  test("failed pipeline run surfaces an error box", async ({ page }) => {
    await loadFixture(page);
    await page.getByRole("button", { name: "+ jq" }).click();
    // `select()` without a comparison is unsupported by the offline jq subset
    // on any input (a bare path like .missing on an array just filters empty
    // matches), so the run fails and the error is surfaced instead.
    await page.locator(".step-config").fill('{ "expression": "select()" }');
    await page.getByRole("button", { name: "Run preview" }).click();
    await expect(page.locator(".error-box")).toBeVisible();
    await expectStatus(page, "Preview failed");
  });
});
