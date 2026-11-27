import { describe, expect, it } from "vitest";
import { changedBlob } from "../../testing/blobs";
import { FILE_CHANGED, friendlyReadError, readBytes } from "./read";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("readBytes", () => {
  it("reads a byte range, clipped to the Blob", async () => {
    const source = new Blob(["abcdef"]);
    expect(text(await readBytes(source, 1, 4))).toBe("bcd");
    expect(text(await readBytes(source, 4, 99))).toBe("ef");
  });

  it("says what to do when the file changed on disk", async () => {
    // Chrome fails a read of a File whose backing file changed with NotReadableError.
    const read = readBytes(changedBlob("abc"), 0, 3);
    await expect(read).rejects.toMatchObject({
      name: "NotReadableError",
      message: FILE_CHANGED,
    });
    expect(FILE_CHANGED).toBe("File changed on disk. Reopen it.");
  });

  it("also covers a failing arrayBuffer() and a file that was removed", async () => {
    const failing = {
      size: 3,
      slice: () => ({
        arrayBuffer: () =>
          Promise.reject(new DOMException("gone", "NotFoundError")),
      }),
    } as unknown as Blob;
    await expect(readBytes(failing, 0, 3)).rejects.toMatchObject({
      name: "NotReadableError",
      message: FILE_CHANGED,
    });
  });
});

describe("friendlyReadError", () => {
  it("leaves every other error alone", () => {
    const other = new RangeError("nope");
    expect(friendlyReadError(other)).toBe(other);
    expect(friendlyReadError("text")).toBe("text");
  });
});
