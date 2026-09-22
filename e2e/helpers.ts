import type { Page } from "@playwright/test";
import { FIXTURE_TEXT } from "./fixtures";

/**
 * Load the primary array-of-objects fixture through the pasted-text path.
 * Using the textarea keeps tests independent from the hidden file input and
 * exercises the paste ingestion route end to end.
 */
export async function loadFixture(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByPlaceholder("Or paste JSON / JSONL here").fill(FIXTURE_TEXT);
  await page.getByRole("button", { name: "Load pasted text" }).click();
  await expectStatus(page, "Ready to explore");
}

export async function expectStatus(
  page: Page,
  pattern: string | RegExp,
): Promise<void> {
  await page
    .locator('[role="status"]')
    .filter({ hasText: pattern })
    .waitFor({ state: "visible" });
}
