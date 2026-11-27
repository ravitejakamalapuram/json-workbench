import { describe, expect, it, vi } from "vitest";
import { fakeWorker } from "../../testing/fake-worker";
import { TooLargeError } from "../types";
import { createWorkerClient } from "./client";
import type { Handlers, Op } from "./protocol";

type TestOps = {
  echo: Op<{ text: string }, string>;
  count: Op<{ to: number }, number, number, number>;
  size: Op<{ bytes: Uint8Array }, number>;
  wait: Op<null, string>;
  fail: Op<null, null>;
};

function setup(options: { terminable?: boolean } = {}) {
  const signals: AbortSignal[] = [];
  const handlers: Handlers<TestOps> = {
    echo: ({ text }) => text,
    count: ({ to }, { progress, partial }) => {
      for (let n = 1; n <= to; n += 1) partial(n);
      progress(to);
      return to;
    },
    size: ({ bytes }) => bytes.byteLength,
    wait: (_args, { signal }) =>
      new Promise((_resolve, reject) => {
        signals.push(signal);
        signal.addEventListener("abort", () => reject(signal.reason));
      }),
    fail: () => {
      throw new TooLargeError("Too big to load.");
    },
  };
  const workers: Worker[] = [];
  const spawn = vi.fn(() => {
    const worker = fakeWorker(handlers);
    workers.push(worker);
    return worker;
  });
  const client = createWorkerClient<TestOps>(spawn, options);
  return { client, spawn, workers, signals };
}

describe("createWorkerClient", () => {
  it("spawns one worker on the first call and matches replies by id", async () => {
    const { client, spawn } = setup();
    expect(spawn).not.toHaveBeenCalled();
    const replies = await Promise.all([
      client.call("echo", { text: "a" }),
      client.call("echo", { text: "b" }),
    ]);
    expect(replies).toEqual(["a", "b"]);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("delivers progress and partial items, then the result", async () => {
    const { client } = setup();
    const seen: string[] = [];
    const result = await client.call(
      "count",
      { to: 3 },
      {
        onProgress: (value) => seen.push(`progress ${value}`),
        onPartial: (items) => seen.push(`partial ${items.join(",")}`),
      },
    );
    expect(result).toBe(3);
    // Progress goes out at once; partial items wait for their batch, which
    // serveWorker flushes before the result.
    expect(seen).toEqual(["progress 3", "partial 1,2,3"]);
  });

  it("rebuilds errors by name", async () => {
    const { client } = setup();
    await expect(client.call("fail", null)).rejects.toBeInstanceOf(
      TooLargeError,
    );
  });

  it("transfers argument buffers to the worker", async () => {
    const { client } = setup();
    const bytes = new Uint8Array(16);
    const size = client.call("size", { bytes });
    expect(bytes.byteLength).toBe(0);
    expect(await size).toBe(16);
  });

  it("cancels through the signal: the call rejects and the handler is aborted", async () => {
    const { client, signals } = setup();
    const controller = new AbortController();
    const waiting = client.call("wait", null, { signal: controller.signal });
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(signals[0]?.aborted).toBe(true));
    expect(await client.call("echo", { text: "still here" })).toBe(
      "still here",
    );
  });

  it("rejects at once when the signal is already aborted", async () => {
    const { client, spawn } = setup();
    const call = client.call(
      "echo",
      { text: "a" },
      { signal: AbortSignal.abort() },
    );
    await expect(call).rejects.toMatchObject({ name: "AbortError" });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("terminates a terminable worker on cancel and spawns a new one for the next call", async () => {
    const { client, spawn, signals } = setup({ terminable: true });
    const controller = new AbortController();
    const waiting = client.call("wait", null, { signal: controller.signal });
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    // The handler never saw the abort: the worker was ended instead.
    expect(signals[0]?.aborted).toBe(false);
    expect(await client.call("echo", { text: "b" })).toBe("b");
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("rejects calls in flight with AbortError on terminate", async () => {
    const { client } = setup();
    const waiting = client.call("wait", null);
    client.terminate();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  });

  it("fails calls in flight when the worker reports an error", async () => {
    const { client, workers, spawn } = setup();
    const waiting = client.call("wait", null);
    workers[0]?.dispatchEvent(
      Object.assign(new Event("error"), { message: "Script failed to load" }),
    );
    await expect(waiting).rejects.toThrow("Script failed to load");
    expect(await client.call("echo", { text: "c" })).toBe("c");
    expect(spawn).toHaveBeenCalledTimes(2);
  });
});
