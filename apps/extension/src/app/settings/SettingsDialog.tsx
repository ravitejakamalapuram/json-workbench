import { useId, useState } from "react";
import {
  MATERIALIZE_LIMITS_MB,
  type MaterializeLimitMb,
  type Theme,
} from "../../platform/types";
import { useAppStore } from "../../store";
import { dayLabel, formatBytes } from "../shell/format";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import "./settings.css";

const THEMES: readonly { readonly id: Theme; readonly label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

/** About 10 times the limit; 128 MB was measured at a peak of 1.4 GB. */
const PEAK: Record<MaterializeLimitMb, string> = {
  32: "320 MB",
  64: "640 MB",
  128: "1.4 GB",
};

/** Settings: theme, the memory limit, recent files and Clear local data. Nothing here asks for a permission. */
export function SettingsDialog({ onClose }: { readonly onClose: () => void }) {
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const limit = useAppStore((state) => state.materializeLimitMb);
  const setLimit = useAppStore((state) => state.setMaterializeLimitMb);
  const recents = useAppStore((state) => state.recents);
  const clearRecents = useAppStore((state) => state.clearRecents);
  const clearLocalData = useAppStore((state) => state.clearLocalData);
  const [notice, setNotice] = useState("");
  const id = useId();

  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="settings">
        <fieldset className="settings-group">
          <legend className="caption">Theme</legend>
          <div className="settings-choices">
            {THEMES.map((option) => (
              <label key={option.id} className="settings-choice">
                <input
                  type="radio"
                  name="theme"
                  checked={theme === option.id}
                  onChange={() => setTheme(option.id)}
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="settings-group">
          <label htmlFor={`${id}-limit`} className="caption">
            Memory limit
          </label>
          <select
            id={`${id}-limit`}
            className="settings-select"
            aria-describedby={`${id}-limit-hint`}
            value={limit}
            onChange={(event) => {
              const chosen = MATERIALIZE_LIMITS_MB.find(
                (mb) => String(mb) === event.target.value,
              );
              if (chosen) setLimit(chosen);
            }}
          >
            {MATERIALIZE_LIMITS_MB.map((mb) => (
              <option key={mb} value={mb}>
                {mb} MB
              </option>
            ))}
          </select>
          <p id={`${id}-limit-hint`} className="muted">
            Export loads a document in full up to this size, which takes about
            10 times its size in memory. At {limit} MB that is up to about{" "}
            {PEAK[limit]}
            {limit === MATERIALIZE_LIMITS_MB.at(-1)
              ? ", which can make the tab slow or fail on a small machine."
              : "."}
          </p>
        </div>

        <section className="settings-group" aria-labelledby={`${id}-recents`}>
          <h3 id={`${id}-recents`} className="caption">
            Recent files
          </h3>
          {recents.length > 0 ? (
            <ul>
              {recents.map((file) => (
                <li key={file.name} className="settings-recent">
                  <span>{file.name}</span>
                  <span className="muted">
                    {formatBytes(file.bytes)} · {dayLabel(file.openedAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No recent files.</p>
          )}
          <Button disabled={recents.length === 0} onClick={clearRecents}>
            Clear recent files
          </Button>
        </section>

        <section className="settings-group" aria-labelledby={`${id}-local`}>
          <h3 id={`${id}-local`} className="caption">
            Local data
          </h3>
          <p className="muted">
            Removes your settings and recent files from this browser. Open
            documents stay open.
          </p>
          <Button
            onClick={async () => {
              try {
                await clearLocalData();
                setNotice("Local data cleared.");
              } catch (error) {
                // The live settings are already reset; the stored ones are not.
                const why = error instanceof Error ? error.message : error;
                setNotice(`Could not clear local data: ${String(why)}`);
              }
            }}
          >
            Clear local data
          </Button>
          <p role="status" className="muted">
            {notice}
          </p>
        </section>
      </div>
    </Modal>
  );
}
