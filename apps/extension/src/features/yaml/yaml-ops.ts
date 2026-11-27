// What the YAML worker does: load the whole document with loadValue (which
// enforces the memory limit) and write it with the codec. The result goes back
// as a Blob, so the converted text never crosses as a string.
import { loadValue } from "../../platform/doc/load-value";
import type { IndexedFormat } from "../../platform/types";
import type { Handlers, Op } from "../../platform/workers/protocol";
import { stringifyYaml, TOO_DEEP_TO_WRITE, YamlError } from "./codec";

export type YamlOps = {
  toYaml: Op<
    {
      readonly source: Blob;
      /** The format of `source`: JSONL loads as a list of its records. */
      readonly format: IndexedFormat;
      /** materializeLimitMb in bytes. */
      readonly maxBytes: number;
    },
    Blob,
    "reading" | "writing"
  >;
};

export const yamlHandlers: Handlers<YamlOps> = {
  async toYaml({ source, format, maxBytes }, { progress }) {
    progress("reading");
    // The JSON reader recurses once per level too, and ends the same way.
    const value = await loadValue(source, "", { format, maxBytes }).catch(
      (error: unknown) => {
        throw error instanceof RangeError
          ? new YamlError(TOO_DEEP_TO_WRITE)
          : error;
      },
    );
    progress("writing");
    return new Blob([stringifyYaml(value)], { type: "application/yaml" });
  },
};
