// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Tabs, type TabItem } from "./Tabs";

afterEach(cleanup);

type View = "tree" | "raw" | "table";
const TABS: readonly TabItem<View>[] = [
  { id: "tree", label: "Tree" },
  { id: "raw", label: "Raw" },
  { id: "table", label: "Table", disabled: "The root is not an array." },
];

function Views() {
  const [view, setView] = useState<View>("tree");
  return (
    <>
      <Tabs
        label="View"
        tabs={TABS}
        selected={view}
        onSelect={setView}
        panelId="panel"
      />
      <div role="tabpanel" id="panel" aria-labelledby={`panel-tab-${view}`}>
        {view}
      </div>
    </>
  );
}

describe("Tabs", () => {
  it("is one tab stop with the selected tab focusable", () => {
    render(<Views />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    expect(screen.getByRole("tab", { selected: true }).textContent).toBe(
      "Tree",
    );
    expect(screen.getByRole("tabpanel", { name: "Tree" })).toBeDefined();
  });

  it("moves focus and selection with the arrow keys, skipping disabled tabs", async () => {
    render(<Views />);
    await userEvent.click(screen.getByRole("tab", { name: "Tree" }));
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement?.textContent).toBe("Raw");
    expect(screen.getByRole("tabpanel").textContent).toBe("raw");
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement?.textContent).toBe("Tree");
    await userEvent.keyboard("{End}");
    expect(document.activeElement?.textContent).toBe("Raw");
    await userEvent.keyboard("{Home}{ArrowLeft}");
    expect(document.activeElement?.textContent).toBe("Raw");
  });

  it("explains a disabled tab and does not select it", async () => {
    render(<Views />);
    const table = screen.getByRole("tab", { name: "Table" });
    expect(table.getAttribute("aria-disabled")).toBe("true");
    expect(table.title).toBe("The root is not an array.");
    await userEvent.click(table);
    expect(screen.getByRole("tabpanel").textContent).toBe("tree");
  });
});
