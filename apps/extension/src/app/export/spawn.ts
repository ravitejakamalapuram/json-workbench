// The one place the export worker is started, so component tests can replace it
// with fakeWorker (there is no global Worker in tests). A worker URL is not an
// import, so the export code stays out of the entry chunk.
export function spawnExportWorker(): Worker {
  return new Worker(new URL("./export.worker.ts", import.meta.url), {
    type: "module",
  });
}
