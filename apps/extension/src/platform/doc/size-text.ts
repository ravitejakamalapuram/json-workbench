const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

/** "2 KB", "1.5 MB" or "1.25 GB": the size in a message the user reads. */
export const sizeText = (bytes: number) =>
  bytes >= GB
    ? `${Number((bytes / GB).toFixed(2))} GB`
    : bytes >= MB
      ? `${Number((bytes / MB).toFixed(1))} MB`
      : `${Number((bytes / KB).toFixed(1))} KB`;
