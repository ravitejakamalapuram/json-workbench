import type { DocumentModel } from "../platform/types";

/** A document still loading; pass overrides for the state a test needs. */
export function documentFixture(
  overrides: Partial<DocumentModel> = {},
): DocumentModel {
  return {
    id: "doc-1",
    name: "orders.json",
    origin: "file",
    format: "json",
    bytes: 2,
    source: new Blob(["{}"]),
    status: { kind: "loading" },
    markers: {},
    edited: false,
    ...overrides,
  };
}
