import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  Action,
  ActionContext,
  DocumentIndex,
  DocumentModel,
  NodeInfo,
} from "../../platform/types";
import { LIMITS } from "../../platform/types";
import { documentFixture, fakeIndex } from "../../testing/fixtures";
import { createTestStore, openText } from "../../testing/render";
import { makeToken } from "./fixtures";
import { jwtActions, openInJwt } from ".";
import { IDLE, jwtState } from "./jwt-state";

const HEADER = { alg: "HS256", typ: "JWT" };
// Longer than the 1,024 characters a tree row keeps of a string.
const LONG = makeToken(HEADER, { data: "x".repeat(3000) });
const SHORT = makeToken(HEADER, { sub: "42" });

const decode = (): Action => {
  const [action] = jwtActions;
  if (!action) throw new Error("no action");
  return action;
};

function stringNode(overrides: Partial<NodeInfo> = {}): NodeInfo {
  return {
    pointer: "/token",
    key: "token",
    kind: "string",
    byteStart: 10,
    byteEnd: 10 + SHORT.length + 2,
    text: SHORT,
    ...overrides,
  };
}

/** What a tree row has of a long string: the first LIMITS.previewChars characters. */
const preview = (token: string) =>
  stringNode({
    text: token.slice(0, LIMITS.previewChars),
    truncated: true,
    byteEnd: 10 + token.length + 2,
  });

function readyDoc(index: DocumentIndex): DocumentModel {
  return documentFixture({
    status: { kind: "ready", index, summary: { records: 1, nodes: 2 } },
  });
}

function context(
  node: NodeInfo | undefined,
  doc: DocumentModel | undefined = readyDoc(fakeIndex()),
  store = createTestStore(),
): ActionContext {
  return { state: store.getState(), doc, node };
}

beforeEach(() => jwtState.setState(IDLE));

describe("the Decode JWT row action", () => {
  it("is one action, offered on rows", () => {
    expect(jwtActions).toHaveLength(1);
    expect(decode()).toMatchObject({
      id: "jwt.decode",
      label: "Decode JWT",
      placement: ["row"],
    });
    expect(decode().shortcut).toBeUndefined();
  });

  describe("when it is offered", () => {
    const offered = (node: NodeInfo | undefined) =>
      decode().when?.(context(node));

    it("is for a string that has the shape of a token", () => {
      expect(offered(stringNode())).toBe(true);
      expect(offered(stringNode({ text: "Ada" }))).toBe(false);
      expect(offered(stringNode({ text: "a.b.c" }))).toBe(false);
      expect(offered(undefined)).toBe(false);
      expect(offered(stringNode({ kind: "number", text: "12" }))).toBe(false);
    });

    it("judges a long token by the shape of its preview", () => {
      expect(offered(preview(LONG))).toBe(true);
      // The preview ends inside the payload, so there is no third part to see.
      expect(preview(LONG).text?.split(".")).toHaveLength(2);
      const prose = "word ".repeat(400);
      expect(offered(stringNode({ text: prose, truncated: true }))).toBe(false);
      const noDots = `${LONG.split(".")[0]}${"A".repeat(2000)}`;
      expect(offered(stringNode({ text: noDots, truncated: true }))).toBe(
        false,
      );
    });

    it("does not offer a preview that is cut inside the header", () => {
      const header = LONG.split(".")[0] ?? "";
      expect(
        offered(stringNode({ text: header.slice(0, 20), truncated: true })),
      ).toBe(false);
    });
  });

  describe("running it", () => {
    it("opens the JWT mode on a token that fits in the row", async () => {
      const store = createTestStore();
      const slice = vi.fn(async () => "");
      await decode().run?.(
        context(stringNode(), readyDoc(fakeIndex({ slice })), store),
      );
      expect(jwtState.getState().token).toBe(SHORT);
      expect(store.getState().mode).toBe("jwt");
      expect(slice).not.toHaveBeenCalled();
    });

    it("reads the whole of a long token, not the row's preview", async () => {
      const store = createTestStore();
      const node = preview(LONG);
      const slice = vi.fn(async () => JSON.stringify(LONG));
      await decode().run?.(
        context(node, readyDoc(fakeIndex({ slice })), store),
      );
      expect(slice).toHaveBeenCalledWith(node.byteStart, node.byteEnd);
      expect(jwtState.getState().token).toBe(LONG);
      expect(store.getState().mode).toBe("jwt");
    });

    it("reads a long token from a document the real engine indexed", async () => {
      const store = createTestStore();
      const doc = await openText(
        store,
        JSON.stringify({ token: LONG, name: "Ada" }),
      );
      if (doc.status.kind !== "ready") throw new Error("not ready");
      const { items } = await doc.status.index.children("", 0, 10);
      const node = items.find((item) => item.key === "token");
      expect(node?.truncated).toBe(true);
      expect(node?.text).toHaveLength(LIMITS.previewChars);
      expect(decode().when?.({ state: store.getState(), doc, node })).toBe(
        true,
      );
      await decode().run?.({ state: store.getState(), doc, node });
      expect(jwtState.getState().token).toBe(LONG);
      expect(store.getState().mode).toBe("jwt");
    });

    it("reads from the expanded string's index when the row is inside one", async () => {
      const store = createTestStore();
      const node = preview(LONG);
      const outer = vi.fn(async () => '"wrong"');
      const inner = vi.fn(async () => JSON.stringify(LONG));
      const embedded = fakeIndex({ slice: inner });
      store.getState().select({
        docId: "doc-1",
        pointer: node.pointer,
        via: ["/payload"],
        index: embedded,
      });
      await decode().run?.(
        context(node, readyDoc(fakeIndex({ slice: outer })), store),
      );
      expect(outer).not.toHaveBeenCalled();
      expect(jwtState.getState().token).toBe(LONG);
    });

    it("ignores a selection that is another row", async () => {
      const store = createTestStore();
      const node = preview(LONG);
      const inner = vi.fn(async () => '"wrong"');
      store.getState().select({
        docId: "doc-1",
        pointer: "/elsewhere",
        via: ["/payload"],
        index: fakeIndex({ slice: inner }),
      });
      const slice = vi.fn(async () => JSON.stringify(LONG));
      await decode().run?.(
        context(node, readyDoc(fakeIndex({ slice })), store),
      );
      expect(inner).not.toHaveBeenCalled();
      expect(jwtState.getState().token).toBe(LONG);
    });

    it("clears whatever was in the page before", async () => {
      jwtState.setState({ token: "old", notice: "old problem" });
      await decode().run?.(context(stringNode()));
      expect(jwtState.getState()).toEqual({ token: SHORT, notice: "" });
    });

    it("says so, and reads nothing, when the string is too large", async () => {
      const store = createTestStore();
      const slice = vi.fn(async () => "");
      const node = stringNode({
        text: LONG.slice(0, LIMITS.previewChars),
        truncated: true,
        byteEnd: 10 + LIMITS.embeddedChars + 1,
      });
      await decode().run?.(
        context(node, readyDoc(fakeIndex({ slice })), store),
      );
      expect(slice).not.toHaveBeenCalled();
      expect(jwtState.getState().token).toBe("");
      expect(jwtState.getState().notice).toBe(
        "This string is too large to decode here.",
      );
      expect(store.getState().mode).toBe("jwt");
    });

    it("shows the reason when the read fails, and does not reject", async () => {
      const store = createTestStore();
      const slice = vi.fn(async () => {
        throw new Error("File changed on disk. Reopen it.");
      });
      await expect(
        decode().run?.(
          context(preview(LONG), readyDoc(fakeIndex({ slice })), store),
        ),
      ).resolves.toBeUndefined();
      expect(jwtState.getState().notice).toBe(
        "File changed on disk. Reopen it.",
      );
      expect(store.getState().mode).toBe("jwt");
    });

    it("says when there is no index to read from", async () => {
      const store = createTestStore();
      await decode().run?.(
        context(
          preview(LONG),
          documentFixture({ status: { kind: "loading" } }),
          store,
        ),
      );
      expect(jwtState.getState().notice).toBe(
        "This token is still being read. Try again in a moment.",
      );
    });
  });
});

describe("openInJwt", () => {
  it("fills the page without switching modes when it is given no store", () => {
    openInJwt(SHORT);
    expect(jwtState.getState().token).toBe(SHORT);
  });

  it("switches to the JWT mode through the store it is given", () => {
    const store = createTestStore();
    openInJwt(SHORT, store.getState());
    expect(store.getState().mode).toBe("jwt");
    expect(jwtState.getState().token).toBe(SHORT);
  });
});
