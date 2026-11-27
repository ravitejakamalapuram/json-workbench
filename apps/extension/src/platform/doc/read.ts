// The one way the doc engine reads a Blob. A File the user picked is read
// lazily for the life of the document (TARGET.md section 5), so a file that
// changed or vanished on disk fails the read long after it was opened.

export const FILE_CHANGED = "File changed on disk. Reopen it.";

/**
 * Chrome's own message for a changed file talks about permissions. Both
 * failures mean the same thing to the user, so they become one error that keeps
 * the NotReadableError name, which the tree and the shell test for.
 */
export function friendlyReadError(error: unknown): unknown {
  if (
    error instanceof Error &&
    (error.name === "NotReadableError" || error.name === "NotFoundError")
  )
    return Object.assign(new Error(FILE_CHANGED), { name: "NotReadableError" });
  return error;
}

/** `source.slice(from, to)` as bytes; `to` may pass the end. */
export async function readBytes(
  source: Blob,
  from: number,
  to: number,
): Promise<Uint8Array<ArrayBuffer>> {
  try {
    return new Uint8Array(await source.slice(from, to).arrayBuffer());
  } catch (error) {
    throw friendlyReadError(error);
  }
}
