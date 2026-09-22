import { expect, test } from "@playwright/test";
import { MALFORMED_TEXT } from "./fixtures";
import { expectStatus, loadFixture } from "./helpers";

test.describe("source loading", () => {
  test("loads pasted JSON and shows file metadata", async ({ page }) => {
    await loadFixture(page);
    await expect(page.locator(".source-file strong")).toHaveText("pasted.json");
    await expect(page.locator(".source-file span").nth(1)).toContainText(
      "JSON",
    );
    await expect(page.locator(".source-file span").nth(1)).toContainText("3");
  });

  test("empty state offers choose file and paste entry points", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "JSON Workbench" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Open a JSON dataset" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Load pasted text" }),
    ).toBeVisible();
  });

  test("malformed input surfaces a parse error with context", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByPlaceholder("Or paste JSON / JSONL here")
      .fill(MALFORMED_TEXT);
    await page.getByRole("button", { name: "Load pasted text" }).click();
    await expectStatus(page, /(ParseError|JsonSyntaxError):/);
    // The streaming scanner keeps the partial root it managed to open before
    // failing — the error status carries the byte-offset context, and no
    // fabricated records appear.
    await expect(page.locator('[role="treeitem"]')).toHaveCount(1);
    await expect(page.getByText("Ada")).toHaveCount(0);
  });
});

test.describe("views and search", () => {
  test("tree view expands nested nodes and exposes a11y roles", async ({
    page,
  }) => {
    await loadFixture(page);
    await expect(page.getByRole("tree")).toBeVisible();
    const first = page.locator('[role="treeitem"]').first();
    await expect(first).toHaveAttribute("aria-level", "1");
    // The root array starts expanded; children (objects) start collapsed.
    await expect(first).toHaveAttribute("aria-expanded", "true");
    const firstChild = page
      .locator('[role="treeitem"][aria-level="2"]')
      .first();
    await expect(firstChild).toHaveAttribute("aria-expanded", "false");
    await firstChild.locator(".expand").click();
    await expect(firstChild).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("Ada")).toBeVisible();
  });

  test("raw view loads the Monaco editor with source", async ({ page }) => {
    await loadFixture(page);
    await page.getByRole("button", { name: "Raw / code" }).click();
    // Monaco is lazy-loaded; first mount can take a while on cold dev-server
    // transforms and modest hardware.
    await expect(page.locator(".monaco-editor")).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.locator(".monaco-editor")).toContainText("Grace", {
      timeout: 30_000,
    });
  });

  test("table view renders records with sortable headers", async ({ page }) => {
    await loadFixture(page);
    await page.getByRole("button", { name: "Table" }).click();
    await expect(page.locator(".table-wrap table")).toBeVisible();
    for (const column of ["id", "name", "active", "score"]) {
      await expect(
        page.locator(".table-wrap thead").getByText(column),
      ).toBeVisible();
    }
    await expect(page.locator(".table-wrap tbody tr")).toHaveCount(3);
    await page.getByRole("button", { name: /name ↕/ }).click();
    await expect(page.locator(".table-wrap tbody tr").first()).toContainText(
      "Ada",
    );
  });

  test("table sorting toggles ascending and descending", async ({ page }) => {
    await loadFixture(page);
    await page.getByRole("button", { name: "Table" }).click();
    const firstCell = page.locator(".table-wrap tbody tr").first();
    await page.getByRole("button", { name: /score ↕/ }).click();
    await expect(firstCell).toContainText("Ada");
    await page.getByRole("button", { name: /score ↕/ }).click();
    await expect(firstCell).toContainText("Linus");
  });

  test("table column hiding removes a column from view", async ({ page }) => {
    await loadFixture(page);
    await page.getByRole("button", { name: "Table" }).click();
    await expect(
      page.locator(".table-wrap thead").getByText("score"),
    ).toBeVisible();
    await page
      .locator(".column-controls label", { hasText: "score" })
      .locator("input")
      .uncheck();
    await expect(
      page.locator(".table-wrap thead").getByText("score"),
    ).toHaveCount(0);
  });

  test("table row selection highlights a record", async ({ page }) => {
    await loadFixture(page);
    await page.getByRole("button", { name: "Table" }).click();
    await page.locator(".table-wrap tbody tr").first().click();
    await expect(page.locator(".table-wrap tbody tr.selected")).toHaveCount(1);
  });

  test("search filters tree rows and regex mode narrows results", async ({
    page,
  }) => {
    await loadFixture(page);
    await page.getByPlaceholder("Search values or paths").fill("Grace");
    await expect(page.getByText("Grace")).toBeVisible();
    await expect(page.getByText("Ada")).toHaveCount(0);
    await page.getByPlaceholder("Search values or paths").fill("^Li");
    await page.locator(".regex-toggle").click();
    // The regex runs against the composite "path key value" text, so anchored
    // patterns must match from the path prefix; "Li" narrows to the Linus row.
    await page.getByPlaceholder("Search values or paths").fill("Li");
    await expect(page.getByText("Linus")).toBeVisible();
    await expect(page.getByText("Grace")).toHaveCount(0);
    await expect(page.getByText("Ada")).toHaveCount(0);
  });
});
