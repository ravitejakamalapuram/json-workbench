import { describe, expect, it } from "vitest";
import { exportData, exportDelimited, exportJsonLines } from "./export";
import { parseJsonValue } from "./input";

describe("exports", () => {
  it("leaves a cell empty when the record lacks a column named like an Object.prototype member", () => {
    const value = parseJsonValue(
      '[{"constructor":1,"__proto__":2,"a":1},{"a":2}]',
    );
    expect(exportDelimited(value, ",")).toBe(
      "constructor,__proto__,a\n1,2,1\n,,2\n",
    );
  });

  it("keeps numeric lexemes in JSON and JSONL output", () => {
    const value = parseJsonValue('[{"id":900719925474099312345}]');
    expect(exportJsonLines(value)).toBe('{"id":900719925474099312345}\n');
    expect(exportData(value, "json", { pretty: false })).toBe(
      '[{"id":900719925474099312345}]',
    );
  });

  it("exports CSV and TSV with escaped cells", () => {
    const value = [{ name: "A, B", count: 2 }];
    expect(exportDelimited(value, ",")).toBe('name,count\n"A, B",2\n');
    expect(exportData(value, "tsv")).toBe("name\tcount\nA, B\t2\n");
  });
});
