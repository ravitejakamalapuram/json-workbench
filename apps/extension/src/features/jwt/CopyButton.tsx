import { useEffect, useState } from "react";
import { Button } from "../../app/ui/Button";

const FEEDBACK_MS = 1500;
type Outcome = "idle" | "copied" | "failed";

/** Copies `text`. `label` is the accessible name ("Copy payload"); the visible word stays short. */
export function CopyButton({
  label,
  text,
}: {
  readonly label: string;
  readonly text: string;
}) {
  const [outcome, setOutcome] = useState<Outcome>("idle");

  useEffect(() => {
    if (outcome === "idle") return;
    const timer = setTimeout(() => setOutcome("idle"), FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [outcome]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setOutcome("copied");
    } catch {
      // Refused (no permission, no focus): say so rather than look done.
      setOutcome("failed");
    }
  }

  return (
    <>
      <Button aria-label={label} onClick={() => void copy()}>
        {outcome === "copied"
          ? "Copied"
          : outcome === "failed"
            ? "Copy failed"
            : "Copy"}
      </Button>
      <span aria-live="polite" className="visually-hidden">
        {outcome === "copied" && "Copied to the clipboard"}
        {outcome === "failed" && "Could not copy to the clipboard"}
      </span>
    </>
  );
}
