import { useRef, useState, type DragEvent, type ReactNode } from "react";
import "./DropZone.css";

type DropZoneProps = {
  readonly onFiles: (files: readonly File[]) => void;
  readonly children: ReactNode;
};

const carriesFiles = (event: DragEvent) =>
  event.dataTransfer.types.includes("Files");

/**
 * The whole page takes dropped files, with or without a document open. Text
 * dragged into a field is left to the field. Open file is the keyboard path.
 */
export function DropZone({ onFiles, children }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  // dragenter and dragleave fire for every child crossed; count them.
  const depth = useRef(0);

  function onDragEnter(event: DragEvent) {
    if (!carriesFiles(event)) return;
    depth.current++;
    setDragging(true);
  }

  function onDragLeave(event: DragEvent) {
    if (!carriesFiles(event) || --depth.current > 0) return;
    depth.current = 0;
    setDragging(false);
  }

  function onDrop(event: DragEvent) {
    depth.current = 0;
    setDragging(false);
    const files = [...event.dataTransfer.files];
    if (files.length === 0) return;
    event.preventDefault();
    onFiles(files);
  }

  return (
    <div
      className="drop-zone"
      onDragEnter={onDragEnter}
      onDragOver={(event) => {
        // Without this the browser opens the file itself instead of dropping it here.
        if (carriesFiles(event)) event.preventDefault();
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <p className="drop-target">Drop to open</p>
        </div>
      )}
    </div>
  );
}
