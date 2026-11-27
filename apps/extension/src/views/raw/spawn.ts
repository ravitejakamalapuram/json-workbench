// The one place the Raw worker is started, so component tests can replace it
// with fakeWorker (there is no global Worker in tests). A worker URL is not an
// import, so none of this code enters the entry chunk.
export function spawnRawWorker(): Worker {
  return new Worker(new URL("./raw.worker.ts", import.meta.url), {
    type: "module",
  });
}
