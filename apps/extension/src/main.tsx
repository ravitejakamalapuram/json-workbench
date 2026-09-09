import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./app.css";

function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>();

  function onFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">DEVELOPER TOOL</div>
          <h1>JSON Workbench</h1>
        </div>
        <span className="status">Local-first</span>
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
            Drag and drop a JSON, JSONL, or NDJSON file here. Processing will stay on your device.
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
