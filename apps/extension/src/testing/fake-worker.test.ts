import { describe, expect, it } from "vitest";
import type { FromWorker, Handlers, Op } from "../platform/workers/protocol";
import { fakeWorker } from "./fake-worker";

type Ops = { echo: Op<{ value: ArrayBuffer | string }, string> };

const handlers: Handlers<Ops> = {
  echo: ({ value }) =>
    typeof value === "string" ? value : `${value.byteLength} bytes`,
};

function reply(worker: Worker): Promise<FromWorker> {
  return new Promise((resolve) =>
    worker.addEventListener("message", (event) => resolve(event.data), {
      once: true,
    }),
  );
}

describe("fakeWorker", () => {
  it("runs the handlers through serveWorker and answers asynchronously", async () => {
    const worker = fakeWorker(handlers);
    const answer = reply(worker);
    worker.postMessage({
      kind: "call",
      id: 1,
      op: "echo",
      args: { value: "hi" },
    });
    let delivered = false;
    void answer.then(() => (delivered = true));
    await Promise.resolve();
    expect(delivered).toBe(false);
    expect(await answer).toEqual({ kind: "result", id: 1, value: "hi" });
  });

  it("refuses what a real worker could not receive as sent", () => {
    const worker = fakeWorker(handlers);
    class Point {
      constructor(readonly x: number) {}
    }
    const call = (args: unknown) => () =>
      worker.postMessage({ kind: "call", id: 1, op: "echo", args });
    expect(call({ value: new Point(1) })).toThrow(/Point cannot cross/);
    expect(call({ value: () => 1 })).toThrow(/Function cannot cross/);
    expect(call({ value: new Map() })).toThrow(/Map cannot cross/);
  });

  it("moves transferred buffers out of the sender", async () => {
    const worker = fakeWorker(handlers);
    const buffer = new ArrayBuffer(8);
    const answer = reply(worker);
    worker.postMessage(
      { kind: "call", id: 2, op: "echo", args: { value: buffer } },
      { transfer: [buffer] },
    );
    expect(buffer.byteLength).toBe(0);
    expect(await answer).toEqual({ kind: "result", id: 2, value: "8 bytes" });
  });

  it("delivers nothing after terminate", async () => {
    const worker = fakeWorker(handlers);
    const messages: unknown[] = [];
    worker.addEventListener("message", (event) => messages.push(event.data));
    worker.postMessage({
      kind: "call",
      id: 3,
      op: "echo",
      args: { value: "a" },
    });
    worker.terminate();
    worker.postMessage({
      kind: "call",
      id: 4,
      op: "echo",
      args: { value: "b" },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(messages).toEqual([]);
  });
});
