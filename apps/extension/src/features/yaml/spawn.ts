// The one place the YAML worker is started, so component tests can replace it
// with fakeWorker (there is no global Worker in tests). A worker URL is not an
// import, so the codec stays out of the entry chunk.
export function spawnYamlWorker(): Worker {
  return new Worker(new URL("./yaml.worker.ts", import.meta.url), {
    type: "module",
  });
}
