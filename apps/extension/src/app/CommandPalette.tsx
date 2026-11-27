import { useEffect, useId, useState, type KeyboardEvent } from "react";
import type { Action, ActionContext } from "../platform/types";
import { useAppStore } from "../store";
import { actionsFor, runAction } from "./actions";
import "./CommandPalette.css";
import { useActionList } from "./ui/actions-context";
import { Kbd } from "./ui/Kbd";
import { Modal } from "./ui/Modal";

/** Every word typed appears in the label, in any order: "go j" finds "Go to JWT". */
function matches(action: Action, query: string): boolean {
  const label = action.label.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => label.includes(word));
}

/**
 * Mod+K: the palette actions that can run now, filtered as you type. The
 * input keeps focus and points at the active option (combobox pattern), so
 * the arrow keys move and Enter runs without leaving the field.
 */
export function CommandPalette({
  context,
}: {
  readonly context: () => ActionContext;
}) {
  const setPaletteOpen = useAppStore((state) => state.setPaletteOpen);
  const actions = useActionList();
  // What can run is decided once, when the palette opens.
  const [offered] = useState(() => actionsFor(actions, context(), "palette"));
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const shown = offered.filter((action) => matches(action, query));
  const optionId = (index: number) => `${listId}-${index}`;
  const close = () => setPaletteOpen(false);

  // Focus stays in the input, so the browser does not scroll a short dialog to the active option.
  useEffect(() => {
    document
      .getElementById(`${listId}-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [listId, active]);

  function run(action: Action) {
    // Closed first, so a dialog the action opens takes focus from the page, not from here.
    close();
    void runAction(action, context());
  }

  function onKeyDown(event: KeyboardEvent) {
    const last = shown.length - 1;
    if (event.key === "ArrowDown") setActive(active >= last ? 0 : active + 1);
    else if (event.key === "ArrowUp")
      setActive(active <= 0 ? last : active - 1);
    else if (event.key === "Enter" && shown[active]) run(shown[active]);
    else return;
    event.preventDefault();
  }

  return (
    <Modal title="Commands" onClose={close}>
      <div className="palette">
        <input
          className="palette-input"
          role="combobox"
          aria-label="Search commands"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={shown[active] ? optionId(active) : undefined}
          placeholder="Type a command"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <ul id={listId} role="listbox" aria-label="Commands">
          {shown.map((action, index) => (
            <li
              key={action.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              className="palette-option"
              onClick={() => run(action)}
              onMouseMove={() => setActive(index)}
            >
              <span>{action.label}</span>
              {action.shortcut && <Kbd shortcut={action.shortcut} />}
            </li>
          ))}
        </ul>
        {shown.length === 0 && <p className="muted">No matching commands.</p>}
      </div>
    </Modal>
  );
}
