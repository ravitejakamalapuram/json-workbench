import { describe, expect, it } from "vitest";
import {
  ACCEPTED_SENDER,
  classifySender,
  isExtensionMessage,
  pageName,
} from "./contract";

const ID = "abcdefghijklmnopabcdefghijklmnop";

describe("classifySender", () => {
  it("treats any page of this extension as an extension page, even inside a tab", () => {
    // Chrome sets sender.tab for the full-tab workbench too, so the URL decides.
    expect(
      classifySender(
        { id: ID, url: `chrome-extension://${ID}/index.html?surface=tab` },
        ID,
      ),
    ).toBe("extension-page");
  });

  it("treats this extension's script on a web page as a content script", () => {
    expect(
      classifySender({ id: ID, url: "https://api.example.com/v1" }, ID),
    ).toBe("content-script");
  });

  it("treats another extension, or a look-alike URL, as foreign or content", () => {
    expect(
      classifySender({ id: "other", url: `chrome-extension://${ID}/` }, ID),
    ).toBe("foreign");
    expect(
      classifySender(
        { id: ID, url: `chrome-extension://${ID}x/index.html` },
        ID,
      ),
    ).toBe("content-script");
    expect(classifySender({}, ID)).toBe("foreign");
  });

  it("accepts each message type from exactly one kind of sender", () => {
    expect(ACCEPTED_SENDER).toEqual({
      "read-active-tab": "extension-page",
      "open-json-in-workbench": "content-script",
    });
  });
});

describe("isExtensionMessage", () => {
  it("accepts the two message shapes", () => {
    expect(isExtensionMessage({ type: "read-active-tab" })).toBe(true);
    expect(
      isExtensionMessage({
        type: "open-json-in-workbench",
        name: "api.example.com",
        text: "{}",
      }),
    ).toBe(true);
  });

  it("rejects unknown types, missing fields and a tab id", () => {
    expect(isExtensionMessage({ type: "capture-network" })).toBe(false);
    expect(
      isExtensionMessage({ type: "open-json-in-workbench", name: "x" }),
    ).toBe(false);
    expect(isExtensionMessage({ type: "read-active-tab", tabId: 7 })).toBe(
      false,
    );
    expect(isExtensionMessage(null)).toBe(false);
    expect(isExtensionMessage("read-active-tab")).toBe(false);
  });
});

describe("pageName", () => {
  it("keeps only the hostname, never the path or query", () => {
    expect(pageName("https://api.example.com/reset/ab12cd.json?token=x")).toBe(
      "api.example.com",
    );
  });

  it("names pages without a host plainly", () => {
    expect(pageName("file:///Users/ada/secret/orders.json")).toBe("Local file");
    expect(pageName("not a url")).toBe("Page");
  });
});
