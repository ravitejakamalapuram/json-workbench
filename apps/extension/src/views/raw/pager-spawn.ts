// The one place the pager's worker is started, so component tests can replace
// it with fakeWorker (there is no global Worker in tests).
export function spawnPagerWorker(): Worker {
  return new Worker(new URL("./pager.worker.ts", import.meta.url), {
    type: "module",
  });
}
