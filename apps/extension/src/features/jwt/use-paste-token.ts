// The shell opens whatever is pasted outside a text field as a document. On
// this page the text is a token, whichever control has focus (a Copy button, the
// bare page), so the shell must not take it.
import { useEffect, type RefObject } from "react";
import { jwtState } from "./jwt-state";

const FIELDS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const DIALOG = '[role="dialog"][aria-modal="true"]';

export function usePasteToken(
  input: RefObject<HTMLTextAreaElement | null>,
): void {
  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const text = event.clipboardData?.getData("text/plain") ?? "";
      const { target } = event;
      const inField =
        target instanceof HTMLElement &&
        (target.isContentEditable || FIELDS.has(target.tagName));
      if (
        event.defaultPrevented ||
        text === "" ||
        inField ||
        document.querySelector(DIALOG)
      )
        return;
      event.preventDefault();
      jwtState.setState({ token: text, notice: "" });
      input.current?.focus();
    }
    // Capturing on the window runs before the shell's listener on the document.
    window.addEventListener("paste", onPaste, true);
    return () => window.removeEventListener("paste", onPaste, true);
  }, [input]);
}
