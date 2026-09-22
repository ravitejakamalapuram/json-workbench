import { expect, test } from "@playwright/test";
import { expectStatus, loadFixture } from "./helpers";

test.describe("local sql panel", () => {
  test("runs a SELECT over the loaded source", async ({ page }) => {
    await loadFixture(page);
    await page.getByRole("button", { name: "Run local SQL" }).click();
    await expectStatus(page, /SQL complete/);
    await expect(page.locator(".sql-result table thead th")).toContainText([
      "id",
      "name",
    ]);
    await expect(page.locator(".sql-result table tbody tr")).toHaveCount(3);
  });

  test("invalid SQL surfaces an error box", async ({ page }) => {
    await loadFixture(page);
    await page.getByLabel("SQL query").fill("SELECT * FROM no_such_table_xyz");
    await page.getByRole("button", { name: "Run local SQL" }).click();
    await expect(page.locator(".sql-panel .error-box")).toBeVisible({
      timeout: 30_000,
    });
    await expectStatus(page, "SQL failed");
  });
});
