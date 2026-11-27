import { useRef, type KeyboardEvent } from "react";

export type TabItem<T extends string> = {
  readonly id: T;
  readonly label: string;
  /** Why the tab cannot be chosen; shown as its title and announced as its description. */
  readonly disabled?: string;
};

type TabsProps<T extends string> = {
  readonly label: string;
  readonly tabs: readonly TabItem<T>[];
  readonly selected: T;
  readonly onSelect: (id: T) => void;
  /** The id of the tabpanel the tabs control; each tab's id is `<panelId>-tab-<id>`. */
  readonly panelId: string;
};

const STEP: Readonly<Record<string, (at: number, last: number) => number>> = {
  ArrowRight: (at) => at + 1,
  ArrowLeft: (at) => at - 1,
  Home: () => 0,
  End: (_at, last) => last,
};

/**
 * A tablist with roving focus: one tab stop, arrow keys move between enabled
 * tabs and select as they go (views switch cheaply), Home and End jump.
 */
export function Tabs<T extends string>({
  label,
  tabs,
  selected,
  onSelect,
  panelId,
}: TabsProps<T>) {
  const list = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent) {
    const step = STEP[event.key];
    const enabled = tabs.filter((tab) => !tab.disabled);
    if (!step || enabled.length === 0) return;
    event.preventDefault();
    const at = enabled.findIndex((tab) => tab.id === selected);
    const index = step(at, enabled.length - 1);
    const next = enabled[(index + enabled.length) % enabled.length];
    if (!next) return;
    onSelect(next.id);
    list.current
      ?.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)
      ?.focus();
  }

  return (
    <div
      ref={list}
      role="tablist"
      aria-label={label}
      className="tabs"
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`${panelId}-tab-${tab.id}`}
          data-tab={tab.id}
          className="tab"
          aria-selected={tab.id === selected}
          aria-controls={panelId}
          aria-disabled={tab.disabled ? true : undefined}
          title={tab.disabled}
          tabIndex={tab.id === selected ? 0 : -1}
          onClick={() => {
            if (!tab.disabled) onSelect(tab.id);
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
