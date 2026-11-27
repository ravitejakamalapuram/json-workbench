import { describe, expect, it } from "vitest";
import type { DocStatus, Registry } from "../platform/types";
import { documentFixture, fakeIndex } from "../testing/fixtures";
import { registry } from "./registry";

/**
 * Shortcut namespaces (TARGET.md, after section 3.3): an action may only use a shortcut of
 * the item its id names, so items built in parallel cannot collide.
 */
const NAMESPACES: Readonly<Record<string, RegExp>> = {
  app: /^(?:Mod\+[KO]|\?|Alt\+[1-5TRB])$/,
  tree: /^(?:Mod\+F|Mod\+Shift\+E|Alt\+Arrow(?:Up|Down|Left|Right))$/,
  raw: /^(?:Mod\+Shift\+F|Mod\+\.)$/,
  table: /^Alt\+C$/,
  compare: /^Mod\+Enter$/,
  transform: /^Mod\+Shift\+Enter$/,
};

/** Modifiers in the order Mod, Alt, Shift, then one key; Shift never precedes punctuation. */
const CANONICAL =
  /^(?:Mod\+)?(?:Alt\+)?(?:(?:Shift\+)?(?:[A-Z0-9]|Enter|Escape|Tab|Arrow(?:Up|Down|Left|Right)|F(?:[1-9]|1[0-2]))|[^\sA-Za-z0-9+])$/;

function duplicates(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
}

export function registryProblems(r: Registry): string[] {
  const problems = [
    ...duplicates(r.modes.map((m) => m.id)).map((id) => `duplicate mode ${id}`),
    ...duplicates(r.views.map((v) => v.id)).map((id) => `duplicate view ${id}`),
    ...duplicates(r.details.map((d) => d.id)).map(
      (id) => `duplicate details section ${id}`,
    ),
    ...duplicates(r.actions.map((a) => a.id)).map(
      (id) => `duplicate action ${id}`,
    ),
  ];
  const owners = new Map<string, string>();
  for (const { id, shortcut } of r.actions) {
    if (!shortcut) continue;
    const owner = id.slice(0, id.indexOf("."));
    if (!CANONICAL.test(shortcut))
      problems.push(`${id}: "${shortcut}" is not in canonical form`);
    else if (!NAMESPACES[owner]?.test(shortcut))
      problems.push(`${id}: "${shortcut}" is outside the ${owner} namespace`);
    const taken = owners.get(shortcut);
    if (taken)
      problems.push(`${id}: "${shortcut}" is already used by ${taken}`);
    owners.set(shortcut, id);
  }
  return problems;
}

describe("registryProblems", () => {
  it("catches duplicate ids, taken shortcuts and shortcuts outside a namespace", () => {
    const run = () => {};
    expect(
      registryProblems({
        ...registry,
        details: [...registry.details, registry.details[0]!],
        actions: [
          {
            id: "raw.format",
            label: "Format",
            shortcut: "Mod+Shift+F",
            placement: [],
            run,
          },
          { id: "raw.format", label: "Format", placement: [], run },
          {
            id: "raw.fix",
            label: "Fix",
            shortcut: "Mod+Shift+F",
            placement: [],
            run,
          },
          {
            id: "jwt.decode",
            label: "Decode",
            shortcut: "Mod+J",
            placement: [],
            run,
          },
          {
            id: "tree.find",
            label: "Find",
            shortcut: "Shift+Mod+F",
            placement: [],
            run,
          },
        ],
      }),
    ).toEqual([
      `duplicate details section ${registry.details[0]!.id}`,
      "duplicate action raw.format",
      'raw.fix: "Mod+Shift+F" is already used by raw.format',
      'jwt.decode: "Mod+J" is outside the jwt namespace',
      'tree.find: "Shift+Mod+F" is not in canonical form',
    ]);
  });
});

describe("registry", () => {
  it("has unique ids and collision-free shortcuts", () => {
    expect(registryProblems(registry)).toEqual([]);
  });

  it("lists modes, views and details sections in display order", () => {
    expect(registry.modes.map((m) => m.id)).toEqual([
      "compare",
      "transform",
      "types",
      "jwt",
    ]);
    expect(registry.views.map((v) => v.id)).toEqual(["tree", "raw", "table"]);
    expect(registry.details.map((d) => d.id)).toEqual([
      "raw-problem",
      "insights",
      "schema",
    ]);
  });

  it("switches modes with Alt+1 to Alt+5 in rail order", () => {
    const modeKeys = registry.actions
      .filter((a) => a.id.startsWith("app.mode."))
      .map((a) => [a.id, a.shortcut]);
    expect(modeKeys).toEqual([
      ["app.mode.view", "Alt+1"],
      ["app.mode.compare", "Alt+2"],
      ["app.mode.transform", "Alt+3"],
      ["app.mode.types", "Alt+4"],
      ["app.mode.jwt", "Alt+5"],
    ]);
  });

  const statuses: DocStatus[] = [
    { kind: "loading" },
    {
      kind: "indexing",
      index: fakeIndex(),
      progress: { indexedBytes: 0, totalBytes: 2, records: 0 },
    },
    { kind: "ready", index: fakeIndex(), summary: { records: 1, nodes: 1 } },
    { kind: "invalid", issues: [] },
    { kind: "failed", message: "File changed on disk. Reopen it." },
  ];

  it("answers supports() for a document in every status without throwing", () => {
    for (const status of statuses)
      for (const view of registry.views) {
        const answer = view.supports(documentFixture({ status }));
        expect(answer === true || typeof answer === "string").toBe(true);
      }
  });

  it("has a view for every status, so the shell can always show one", () => {
    const raw = registry.views.find((view) => view.id === "raw");
    for (const status of statuses)
      expect(raw?.supports(documentFixture({ status }))).toBe(true);
  });
});
