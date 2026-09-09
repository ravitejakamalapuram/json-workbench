import { describe, expect, it } from "vitest";
import { parseJsonStructure } from "./structure";
import { profileJsonStructure } from "./profile";

async function* chunks(text: string): AsyncGenerator<string> {
  yield text;
}

describe("profileJsonStructure", () => {
  it("counts structural and primitive statistics", async () => {
    const profile = await profileJsonStructure(
      parseJsonStructure(chunks('{"users":[{"id":1,"active":true},null]}')),
    );
    expect(profile.objects).toBe(2);
    expect(profile.arrays).toBe(1);
    expect(profile.primitives).toBe(3);
    expect(profile.primitiveTypes).toEqual({ number: 1, boolean: 1, null: 1 });
    expect(profile.propertyNames).toEqual({ users: 1, id: 1, active: 1 });
    expect(profile.maxDepth).toBe(2);
    expect(profile.fieldStats.id!.types).toEqual(["number"]);
    expect(profile.fieldStats.active!.occurrences).toBe(1);
    expect(profile.fieldStats.active!.missing).toBe(1);
    expect(profile.depthCounts["1"]).toBe(1);
    expect(profile.arrayLengths).toEqual([2]);
  });
});
