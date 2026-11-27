const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

/** "2 KB", "1.5 MB" or "1.25 GB": the size in a message the user reads. `more` adds decimals. */
export const sizeText = (bytes: number, more = 0) =>
  bytes >= GB
    ? `${Number((bytes / GB).toFixed(2 + more))} GB`
    : bytes >= MB
      ? `${Number((bytes / MB).toFixed(1 + more))} MB`
      : `${Number((bytes / KB).toFixed(1 + more))} KB`;

const MOST_MORE = 4;

/**
 * A size and the limit it is over, spelled so they never read the same. At
 * two decimals a file 4 MB over a 1.25 GB limit is "1.25 GB" too, which reads
 * as if it fit. Digits are added to both until they differ, and exact bytes
 * are the last resort when a few bytes are all that separate them.
 */
export function sizeAgainst(
  size: number,
  limit: number,
): readonly [string, string] {
  for (let more = 0; more <= MOST_MORE; more += 1) {
    const [a, b] = [sizeText(size, more), sizeText(limit, more)];
    if (a !== b) return [a, b];
  }
  const bytes = (n: number) => `${n.toLocaleString("en-US")} bytes`;
  return [bytes(size), bytes(limit)];
}
