import { inExtension, openFullTab } from "../../platform/chrome";
import type { ModePlugin } from "../../platform/types";
import { useAppStore, useAppStoreApi } from "../../store";
import { dayLabel, formatBytes } from "./format";
import { openRecent } from "./open";
import { openDialog } from "./session";

/**
 * The 208 px left rail: the shell's "View", the modes, recent files, Settings
 * and the local-only note. Below 640 px shell.css lays it out as a top mode
 * strip and hides the brand, recents and note (the empty state lists recents).
 */
export function Rail({ modes }: { readonly modes: readonly ModePlugin[] }) {
  const store = useAppStoreApi();
  const mode = useAppStore((state) => state.mode);
  const setMode = useAppStore((state) => state.setMode);
  const recents = useAppStore((state) => state.recents);
  const panel = useAppStore((state) => state.surface === "panel");
  const items = [{ id: "view", label: "View" } as const, ...modes];

  return (
    <div className="rail">
      <h1 className="brand">
        <span className="brand-mark" aria-hidden="true">
          {"{ }"}
        </span>{" "}
        JSON Workbench
      </h1>
      <nav aria-label="Modes">
        <ul className="rail-list">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="rail-item"
                aria-current={item.id === mode ? "page" : undefined}
                onClick={() => setMode(item.id)}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {recents.length > 0 && (
        <section className="rail-recents" aria-labelledby="rail-recents">
          <h2 id="rail-recents" className="caption">
            Recent
          </h2>
          <ul className="rail-list">
            {recents.map((file) => (
              <li key={file.name}>
                <button
                  type="button"
                  className="rail-item"
                  title={`${formatBytes(file.bytes)} · ${dayLabel(file.openedAt)}`}
                  onClick={() => openRecent(store.getState(), file)}
                >
                  {file.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="rail-foot">
        <ul className="rail-list">
          {panel && inExtension() && (
            <li>
              <button
                type="button"
                className="rail-item"
                onClick={() => void openFullTab()}
              >
                Open in full tab
              </button>
            </li>
          )}
          <li>
            <button
              type="button"
              className="rail-item"
              onClick={() => openDialog({ kind: "settings" })}
            >
              Settings
            </button>
          </li>
        </ul>
        <p className="rail-note">Local only · nothing uploaded</p>
      </div>
    </div>
  );
}
