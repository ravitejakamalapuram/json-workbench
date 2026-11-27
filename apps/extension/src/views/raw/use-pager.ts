// The pager's side of its worker: the scan that counts rows while the list is
// already usable, and the few rows around the screen. Nothing here holds more
// than a screenful of text (TARGET.md section 5).
import { useCallback, useEffect, useRef, useState } from "react";
import { createWorkerClient } from "../../platform/workers/client";
import type { WorkerClient } from "../../platform/workers/protocol";
import type { PagerOps, PagerRow } from "./pager-ops";
import { spawnPagerWorker } from "./pager-spawn";

/** Rows kept either side of the last ones asked for, so a short scroll back is not a read. */
const KEEP_ROWS = 300;

const isAbort = (error: unknown) =>
  error instanceof Error && error.name === "AbortError";

export function usePager(source: Blob) {
  const [counted, setCounted] = useState({ rows: 0, lines: 0 });
  const [scanning, setScanning] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  /** Bumped when rows arrive, so the list draws them. */
  const [version, setVersion] = useState(0);
  const client = useRef<WorkerClient<PagerOps> | null>(null);
  const cache = useRef(new Map<number, PagerRow>());
  const reading = useRef<AbortController | null>(null);

  const fail = useCallback((error: unknown) => {
    if (!isAbort(error))
      setFailure(error instanceof Error ? error.message : String(error));
  }, []);

  // The list asks for rows before this component's own effects run, so the
  // worker starts on first use and the scan is its first message.
  const worker = useCallback(() => {
    if (client.current) return client.current;
    const started = createWorkerClient<PagerOps>(spawnPagerWorker);
    client.current = started;
    started
      .call(
        "open",
        { source },
        { onProgress: ({ rows, lines }) => setCounted({ rows, lines }) },
      )
      .then((done) => {
        setCounted(done);
        setScanning(false);
      }, fail);
    return started;
  }, [source, fail]);

  useEffect(() => {
    worker();
    const rows = cache.current;
    return () => {
      reading.current?.abort();
      client.current?.terminate();
      client.current = null;
      rows.clear();
    };
  }, [worker]);

  /** Reads the rows [start, end) unless they are all here; the latest request wins. */
  const show = useCallback(
    (start: number, end: number) => {
      const rows = cache.current;
      let missing = false;
      for (let at = start; at < end && !missing; at += 1)
        missing = !rows.has(at);
      if (!missing || end <= start) return;
      reading.current?.abort();
      const controller = new AbortController();
      reading.current = controller;
      worker()
        .call(
          "rows",
          { first: start, count: end - start },
          { signal: controller.signal },
        )
        .then((read) => {
          for (const row of read) rows.set(row.row, row);
          for (const at of rows.keys())
            if (at < start - KEEP_ROWS || at >= end + KEEP_ROWS)
              rows.delete(at);
          setVersion((before) => before + 1);
        }, fail);
    },
    [worker, fail],
  );

  const rowAt = useCallback(
    (byteOffset: number) => worker().call("rowAt", { byteOffset }),
    [worker],
  );
  const rowOfLine = useCallback(
    (line: number) => worker().call("rowOfLine", { line }),
    [worker],
  );

  return {
    ...counted,
    scanning,
    failure,
    version,
    row: (at: number) => cache.current.get(at),
    show,
    rowAt,
    rowOfLine,
  };
}
