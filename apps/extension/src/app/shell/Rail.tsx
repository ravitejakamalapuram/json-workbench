import type { ModePlugin } from "../../platform/types";
import { useAppStore } from "../../store";
import { dayLabel, formatBytes } from "./format";

/** The 208 px left rail: the shell's "View", then the modes, then recent files. */
export function Rail({ modes }: { readonly modes: readonly ModePlugin[] }) {
  const mode = useAppStore((state) => state.mode);
  const setMode = useAppStore((state) => state.setMode);
  const recents = useAppStore((state) => state.recents);
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
          {/* Names only: no file handle is kept, so a recent cannot reopen. */}
          <ul className="rail-list">
            {recents.map((file) => (
              <li
                key={file.name}
                className="rail-recent"
                title={`${formatBytes(file.bytes)} · ${dayLabel(file.openedAt)}`}
              >
                {file.name}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
