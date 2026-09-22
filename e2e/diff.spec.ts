import { expect, test } from "@playwright/test";
import { loadFixture } from "./helpers";

test.describe("diff", () => {
  test("computes a diff against pasted JSON with navigable ops", async ({
    page,
  }) => {
    await loadFixture(page);
    await page.getByTestId("diff-input").fill(
      JSON.stringify([
        { id: 1, name: "Ada", active: true, score: 10 },
        { id: 2, name: "Grace", active: true, score: 20 },
        { id: 4, name: "New", active: false, score: 40 },
      ]),
    );
    await page.getByTestId("diff-run-button").click();
    const results = page.getByTestId("diff-results");
    await expect(results).toBeVisible();
    // Positional array diff (see packages/core/src/diff.ts): /1/active flips →
    // replace; /2 keeps its index but every leaf differs → 4 replaces; equal
    // lengths mean no add/remove ops. Total: 5 replaces.
    await expect(results.locator(".badge.op-replace")).toHaveCount(5);
    await expect(results.locator(".badge.op-remove")).toHaveCount(0);
    await expect(results.locator(".badge.op-add")).toHaveCount(0);
    await expect(results).toContainText("/1/active");
    await expect(results).toContainText("/2/score");
  });

  test("identical inputs report no differences", async ({ page }) => {
    await loadFixture(page);
    await page
      .getByTestId("diff-input")
      .fill(
        '[{"id":1,"name":"Ada","active":true,"score":10},{"id":2,"name":"Grace","active":false,"score":20},{"id":3,"name":"Linus","active":true,"score":30}]',
      );
    await page.getByTestId("diff-run-button").click();
    await expect(
      page.getByText("No differences", { exact: true }),
    ).toBeVisible();
  });

  test("side-by-side visual modal renders highlighted trees", async ({
    page,
  }) => {
    await loadFixture(page);
    await page.getByTestId("diff-input").fill('[{"id":1,"name":"Zed"}]');
    await page.getByTestId("diff-run-button").click();
    await page.getByTestId("diff-visual-button").click();
    const modal = page.getByTestId("diff-visual-modal");
    await expect(modal).toBeVisible();
    await expect(modal.locator(".diff-column")).toHaveCount(2);
    await expect(
      modal
        .locator(".jwb-diff-add, .jwb-diff-remove, .jwb-diff-replace")
        .first(),
    ).toBeVisible();
    await page.getByTestId("diff-visual-close").click();
    await expect(modal).toHaveCount(0);
  });

  test("export patch and apply patch actions are available", async ({
    page,
  }) => {
    await loadFixture(page);
    await page.getByTestId("diff-input").fill('[{"id":1,"name":"Zed"}]');
    await page.getByTestId("diff-run-button").click();
    await expect(page.getByTestId("diff-export-button")).toBeVisible();
    await expect(page.getByTestId("diff-apply-button")).toBeVisible();
  });
});
