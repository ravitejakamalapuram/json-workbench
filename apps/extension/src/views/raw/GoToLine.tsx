import { useEffect, useRef, type KeyboardEvent } from "react";
import { Button } from "../../app/ui/Button";

type GoToLineProps = {
  /** Lines counted so far. */
  readonly lines: number;
  /** The count is still growing. */
  readonly scanning: boolean;
  /** Why the last jump did not happen. */
  readonly message: string;
  readonly onGo: (line: number) => void;
  readonly onClose: () => void;
};

/** "1 line", "2 lines": the count of lines read so far, with "+" while the scan still counts. */
export const linesText = (lines: number, scanning = false) =>
  `${lines.toLocaleString("en-US")}${scanning ? "+" : ""} line${lines === 1 && !scanning ? "" : "s"}`;

/** The small input over the top corner of the rows that Mod+G opens. */
export function GoToLine({
  lines,
  scanning,
  message,
  onGo,
  onClose,
}: GoToLineProps) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onClose();
  }

  return (
    <form
      className="raw-goto"
      onKeyDown={onKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        const line = Number(input.current?.value);
        if (Number.isInteger(line) && line >= 1) onGo(line);
      }}
    >
      <label htmlFor="raw-goto-line">Go to line</label>
      <input
        ref={input}
        id="raw-goto-line"
        className="raw-goto-input"
        type="number"
        min={1}
        required
      />
      <Button type="submit">Go</Button>
      <span className="muted">of {linesText(lines, scanning)}</span>
      {message && <span role="status">{message}</span>}
    </form>
  );
}
