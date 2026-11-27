// Blob doubles for what a real file does after it was opened: it is read in
// parts, and it can change. They are real Blob subclasses, so the fake worker
// passes them by reference as a worker would.

/** Counts the bytes read through slice(), to show that a query does not read the whole file or too much at once. */
export class CountingBlob extends Blob {
  reads = 0;
  /** The size of the biggest single read. */
  largest = 0;
  override slice(start?: number, end?: number, type?: string): Blob {
    const part = super.slice(start, end, type);
    this.reads += part.size;
    this.largest = Math.max(this.largest, part.size);
    return part;
  }
}

/**
 * A Blob that reads like its parts until change() is called, then throws the
 * NotReadableError Chrome raises for a File whose backing file changed. Code
 * under test only calls size and slice.
 */
export class ChangingBlob extends Blob {
  #changed = false;

  /** The file changes on disk: from now on every read throws. */
  change(): void {
    this.#changed = true;
  }

  override slice(start?: number, end?: number, type?: string): Blob {
    if (this.#changed)
      throw new DOMException(
        "The requested file could not be read.",
        "NotReadableError",
      );
    return super.slice(start, end, type);
  }
}

/** A Blob whose file already changed. */
export function changedBlob(...parts: BlobPart[]): Blob {
  const blob = new ChangingBlob(parts);
  blob.change();
  return blob;
}
