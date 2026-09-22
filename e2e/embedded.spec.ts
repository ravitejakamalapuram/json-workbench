import { expect, test } from "@playwright/test";
import { EMBEDDED_FIXTURE_TEXT } from "./fixtures";
import { expectStatus, loadFixture } from "./helpers";

test.describe("embedded json panel", () => {
  test("detects stringified JSON and offers copy-as-parsed", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByPlaceholder("Or paste JSON / JSONL here")
      .fill(EMBEDDED_FIXTURE_TEXT);
    await page.getByRole("button", { name: "Load pasted text" }).click();
    await expectStatus(page, "Ready to explore");
    const list = page.getByTestId("embedded-list");
    await expect(list).toBeVisible();
    await expect(list).toContainText("/0/payload");
    await expect(
      list.getByRole("button", { name: "Copy parsed" }),
    ).toBeVisible();
  });

  test("plain JSON shows the empty-state copy", async ({ page }) => {
    await loadFixture(page);
    await expect(page.getByTestId("embedded-panel")).toContainText(
      "No JSON hidden inside string fields",
    );
  });
});

test.describe("shell", () => {
  test("theme toggle persists a light theme and switches back", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Toggle theme" }).click();
    await expect(page.locator("main.shell")).toHaveClass(/light/);
    expect(
      await page.evaluate(() => localStorage.getItem("json-workbench:theme")),
    ).toBe("light");
    await page.getByRole("button", { name: "Toggle theme" }).click();
    await expect(page.locator("main.shell")).toHaveClass(/dark/);
  });

  test("settings panel opens with page-integration controls", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("settings-button").click();
    await expect(page.getByTestId("settings-panel")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Format current tab now" }),
    ).toBeVisible();
    await page.getByTestId("settings-button").click();
    await expect(page.getByTestId("settings-panel")).toHaveCount(0);
  });

  test("pipeline recipe persists to localStorage across reloads", async ({
    page,
  }) => {
    await loadFixture(page);
    await page.getByRole("button", { name: "+ Filter" }).click();
    await expect(page.locator(".steps .step")).toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate(() => localStorage.getItem("json-workbench:pipeline")),
      )
      .toContain('"filter"');
    await page.reload();
    // Sources are not persisted (File objects cannot be), so the reload shows
    // the empty state; loading a dataset again must surface the saved recipe.
    await loadFixture(page);
    await expect(page.locator(".steps .step")).toHaveCount(1);
  });
});
