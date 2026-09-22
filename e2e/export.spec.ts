import { expect, test } from "@playwright/test";
import { expectStatus, loadFixture } from "./helpers";

test.describe("export and codegen", () => {
  test("export buttons exist for all formats", async ({ page }) => {
    await loadFixture(page);
    for (const label of ["JSON", "JSONL", "NDJSON", "CSV", "TSV"]) {
      await expect(
        page.locator(".export-grid").getByRole("button", {
          name: label,
          exact: true,
        }),
      ).toBeVisible();
    }
  });

  test("CSV export downloads the visible dataset", async ({ page }) => {
    await loadFixture(page);
    const download = page.waitForEvent("download");
    await page
      .locator(".export-grid")
      .getByRole("button", { name: "CSV" })
      .click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.csv$/);
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const csv = Buffer.concat(chunks).toString("utf8");
    expect(csv.split("\n")[0]).toContain("id,name,active,score");
    expect(csv).toContain("Ada");
  });

  test("JSON export round-trips the source losslessly", async ({ page }) => {
    await loadFixture(page);
    const download = page.waitForEvent("download");
    await page
      .locator(".export-grid")
      .getByRole("button", { name: "JSON", exact: true })
      .click();
    const file = await download;
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Array<{
      id: number;
      name: string;
    }>;
    expect(data).toHaveLength(3);
    expect(data[0]).toEqual({ id: 1, name: "Ada", active: true, score: 10 });
    await expectStatus(page, "Exported JSON");
  });

  test("codegen panel generates pipeline code for each target", async ({
    page,
  }) => {
    await loadFixture(page);
    await page.getByRole("button", { name: "+ Filter" }).click();
    const pre = page.locator(".codegen pre");
    // Default filter config is { field: "id", equals: 1 } → codegen reflects it.
    await expect(pre).toContainText("id", { timeout: 15_000 });
    for (const target of [
      "JSONata",
      "jq",
      "JavaScript",
      "TypeScript",
      "Python",
      "SQL",
    ]) {
      await page
        .locator(".codegen select")
        .selectOption(
          target === "JSONata"
            ? "jsonata"
            : target === "jq"
              ? "jq"
              : target === "JavaScript"
                ? "javascript"
                : target === "TypeScript"
                  ? "typescript"
                  : target === "Python"
                    ? "python"
                    : "sql",
        );
      await expect(pre).toContainText(/.+/);
    }
    await expect(pre).toContainText("SELECT");
  });

  test("copy generated code button is present", async ({ page }) => {
    await loadFixture(page);
    await expect(
      page.getByRole("button", { name: "Copy generated code" }),
    ).toBeVisible();
  });
});
