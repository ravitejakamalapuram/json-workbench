import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "../ui/Button";

export type MenuItem = {
  readonly id: string;
  readonly label: string;
  readonly onSelect: () => void;
};

const STEP: Readonly<Record<string, number>> = { ArrowDown: 1, ArrowUp: -1 };

/**
 * "More": the toolbar's secondary controls when the toolbar is too narrow for
 * them. A menu button: the first item takes focus, the arrow keys move,
 * Escape closes and returns focus, a click elsewhere closes.
 */
export function OverflowMenu({
  items,
}: {
  readonly items: readonly MenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  function onKeyDown(event: KeyboardEvent) {
    const entries = [
      ...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ??
        []),
    ];
    const at = entries.indexOf(document.activeElement as HTMLElement);
    const step = STEP[event.key];
    if (event.key === "Tab") return setOpen(false);
    if (event.key === "Escape") {
      setOpen(false);
      button.current?.focus();
    } else if (step !== undefined)
      entries[(at + step + entries.length) % entries.length]?.focus();
    else return;
    event.preventDefault();
  }

  if (items.length === 0) return null;
  return (
    <div ref={root} className="menu-anchor" onKeyDown={onKeyDown}>
      <Button
        ref={button}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
      >
        More
      </Button>
      {open && (
        <ul id={menuId} role="menu" aria-label="More" className="menu">
          {items.map((item) => (
            <li key={item.id} role="none">
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="menu-item"
                onClick={() => {
                  setOpen(false);
                  button.current?.focus();
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
