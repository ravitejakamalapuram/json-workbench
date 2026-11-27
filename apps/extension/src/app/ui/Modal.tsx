import {
  useId,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type ModalProps = {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
};

/**
 * A dialog on the scrim. While it is open every other child of body (the app
 * root, a dialog below this one) is inert, so neither the mouse, Tab nor a
 * screen reader reaches the page behind; Tab also wraps inside the dialog.
 * Escape and Close call onClose, and focus returns to the opener.
 */
export function Modal({ title, onClose, children }: ModalProps) {
  const overlay = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    // Only undo what this dialog did: an element already inert belongs to a
    // dialog below, which restores it itself.
    const madeInert = [...document.body.children].filter(
      (element) =>
        element !== overlay.current && !element.hasAttribute("inert"),
    );
    madeInert.forEach((element) => element.setAttribute("inert", ""));
    const first =
      body.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      overlay.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => {
      madeInert.forEach((element) => element.removeAttribute("inert"));
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      // A dialog below this one is a React ancestor and would close too.
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !overlay.current) return;
    const focusable = [
      ...overlay.current.querySelectorAll<HTMLElement>(FOCUSABLE),
    ];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const wrapTo = event.shiftKey
      ? document.activeElement === first && last
      : document.activeElement === last && first;
    if (wrapTo) {
      event.preventDefault();
      wrapTo.focus();
    }
  }

  return createPortal(
    <div ref={overlay} className="overlay" onKeyDown={onKeyDown}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dialog"
      >
        <div className="dialog-header">
          <h2 id={titleId} className="dialog-title">
            {title}
          </h2>
          <button
            type="button"
            className="button button-text"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div ref={body} className="dialog-body">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
