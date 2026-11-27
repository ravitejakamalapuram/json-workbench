import { LosslessNumber } from "lossless-json";
import { describe, expect, it } from "vitest";
import { TooLargeError, type NodeInfo } from "../types";
import {
  fromWireError,
  PARTIAL_BATCH,
  PARTIAL_FLUSH_MS,
  PROGRESS_INTERVAL_MS,
  toWireError,
  transferables,
  type DocOps,
  type Handlers,
  type Op,
  type Plain,
  type WorkerClient,
} from "./protocol";

// The typing rules of TARGET.md 3.5, checked by `npm run typecheck`.
type EchoOps = {
  echo: Op<{ text: string }, string, number, string>;
  quiet: Op<null, null>;
};

export const plainValues: Plain[] = [
  null,
  1,
  "a",
  [true, { nested: [new Blob(["x"])] }],
  new Uint8Array(2),
];

// @ts-expect-error a class instance with methods is not plain data
export const losslessIsNotPlain: Plain = new LosslessNumber("1");
// @ts-expect-error functions cannot cross a worker boundary
export const functionIsNotPlain: Plain = () => 1;

export const handlers: Handlers<EchoOps> = {
  echo: ({ text }, ctx) => {
    ctx.progress(50);
    ctx.partial(text);
    // @ts-expect-error progress values are typed per op
    ctx.progress("half");
    return text;
  },
  quiet: (_args, ctx) => {
    // @ts-expect-error an op without progress cannot report it
    ctx.progress(1);
    return null;
  },
};

export async function callSite(client: WorkerClient<EchoOps>) {
  const text: string = await client.call(
    "echo",
    { text: "hi" },
    { onPartial: (items: readonly string[]) => items },
  );
  // @ts-expect-error arguments are typed per op
  await client.call("echo", { txt: "hi" });
  // @ts-expect-error unknown ops do not exist
  await client.call("shout", null);
  return text;
}

export async function docCall(client: WorkerClient<DocOps>) {
  const page = await client.call("children", {
    pointer: "",
    offset: 0,
    limit: 200,
  });
  const first: NodeInfo | undefined = page.items[0];
  return first;
}

describe("protocol", () => {
  it("throttles progress and batches partial results", () => {
    expect(PROGRESS_INTERVAL_MS).toBe(100);
    expect(PARTIAL_FLUSH_MS).toBe(50);
    expect(PARTIAL_BATCH).toBe(500);
  });

  it("sends errors as name and message so the client can rebuild them", () => {
    const tooLarge = Object.assign(new Error("Too big"), {
      name: "TooLargeError",
    });
    expect(toWireError(tooLarge)).toEqual({
      name: "TooLargeError",
      message: "Too big",
    });
    expect(toWireError("boom")).toEqual({ name: "Error", message: "boom" });
  });

  it("rebuilds TooLargeError and AbortError on the client", () => {
    expect(
      fromWireError({ name: "TooLargeError", message: "Too big" }),
    ).toBeInstanceOf(TooLargeError);
    const aborted = fromWireError({ name: "AbortError", message: "Stopped" });
    expect(aborted).toBeInstanceOf(DOMException);
    expect(aborted.name).toBe("AbortError");
    const other = fromWireError({ name: "JsonSyntaxError", message: "Bad" });
    expect([other.name, other.message]).toEqual(["JsonSyntaxError", "Bad"]);
  });

  it("lists every buffer once for the transfer list, never a Blob", () => {
    const bytes = new Uint8Array(4);
    const buffer = new ArrayBuffer(2);
    const found = transferables({
      bytes,
      again: [bytes, buffer],
      buffer,
      blob: new Blob(["x"]),
    });
    expect(found).toEqual([bytes.buffer, buffer]);
  });
});
