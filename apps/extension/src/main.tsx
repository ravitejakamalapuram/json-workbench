import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { JsonStructureEvent } from "@json-workbench/core";
import { ingestFile } from "./ingest";
import "./app.css";

function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const taskRef = useRef<{ cancel: () => void }>();
  const [fileName, setFileName] = useState<string>();
  const [status, setStatus] = useState("Ready");
  const [progress, setProgress] = useState(0);
  const [eventCount, setEventCount] = useState(0);

  function onFile(file: File | undefined) {
    if (!file) return;
    taskRef.current?.cancel();
    setFileName(file.name);
    setStatus("Scanning…");
    setProgress(0);
    setEventCount(0);
    let count = 0;
    taskRef.current = ingestFile(file, {
      onEvent: (_event: JsonStructureEvent) => {
        count++;
        setEventCount(count);
      },
      onProgress: ({ loaded, total }) => setProgress(total ? Math.round((loaded / total) * 100) : 0),
      onComplete: () => setStatus("Ready to explore"),
      onError: (error) => setStatus(`${error.name}: ${error.message}`),
    });
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">DEVELOPER TOOL</div>
          <h1>JSON Workbench</h1>
        </div>
        <span className="status">{status}</span>
      </header>

      <section className="workspace">
        <div
          className="dropzone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            onFile(event.dataTransfer.files[0]);
          }}
        >
          <div className="icon">{fileName ? "✓" : "{}"}</div>
          <h2>{fileName ?? "Open a JSON file"}</h2>
          <p>
            Drag and drop a JSON, JSONL, or NDJSON file here. Processing stays on your device and runs off the UI thread.
          </p>
          <button type="button" onClick={() => inputRef.current?.click()}>
            Choose file
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".json,.jsonl,.ndjson,application/json"
            hidden
            onChange={(event) => onFile(event.target.files?.[0])}
          />
          {fileName && (
            <div className="progress" aria-live="polite">
              <div className="progress-bar" style={{ width: `${progress}%` }} />
              <span>{progress}% · {eventCount.toLocaleString()} structural events</span>
            </div>
          )}
        </div>

        <div className="pipeline-card">
          <div>
            <span className="card-label">PIPELINE</span>
            <h3>Source → Analyze → Transform → Validate → Export</h3>
          </div>
          <span className="coming-soon">Foundation</span>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
