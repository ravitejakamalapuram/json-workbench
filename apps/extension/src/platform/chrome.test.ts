import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeChrome } from "../testing/fake-chrome";
import {
  activeTabHost,
  hasHostAccess,
  inExtension,
  openFullTab,
  requestHostAccess,
  sendMessage,
} from "./chrome";

afterEach(() => vi.unstubAllGlobals());

describe("inExtension", () => {
  it("is false under Vite dev and tests, true with the extension runtime", () => {
    expect(inExtension()).toBe(false);
    installFakeChrome();
    expect(inExtension()).toBe(true);
  });
});

describe("host access", () => {
  it("asks for one site over http and https", async () => {
    const chrome = installFakeChrome();
    expect(await hasHostAccess({ host: "api.example.com" })).toBe(false);
    expect(await requestHostAccess({ host: "api.example.com" })).toBe(true);
    expect(chrome.permissions.request).toHaveBeenCalledWith({
      origins: ["*://api.example.com/*"],
    });
    expect(await hasHostAccess({ host: "api.example.com" })).toBe(true);
  });

  it("asks for every site with <all_urls>", async () => {
    const chrome = installFakeChrome();
    chrome.permissions.request.mockResolvedValueOnce(false);
    expect(await requestHostAccess("all")).toBe(false);
    expect(chrome.permissions.request).toHaveBeenCalledWith({
      origins: ["<all_urls>"],
    });
  });
});

describe("activeTabHost", () => {
  it("names the host of the tab in front when its URL is visible", async () => {
    const chrome = installFakeChrome();
    const tab = (url?: string) => [{ url } as chrome.tabs.Tab];
    chrome.tabs.query.mockResolvedValueOnce(
      tab("http://localhost:3000/api/orders?token=x"),
    );
    expect(await activeTabHost()).toBe("localhost");
    expect(chrome.tabs.query).toHaveBeenCalledWith({
      active: true,
      lastFocusedWindow: true,
    });
    // Without an icon click on that page Chrome hides the URL.
    chrome.tabs.query.mockResolvedValueOnce(tab(undefined));
    expect(await activeTabHost()).toBeNull();
    chrome.tabs.query.mockResolvedValueOnce(tab("chrome://extensions/"));
    expect(await activeTabHost()).toBeNull();
    expect(await activeTabHost()).toBeNull();
  });
});

describe("openFullTab", () => {
  it("opens the workbench page in a tab, with the handoff id when given", async () => {
    const chrome = installFakeChrome();
    await openFullTab();
    await openFullTab("h1");
    expect(chrome.tabs.create.mock.calls.map(([props]) => props.url)).toEqual([
      "chrome-extension://fakeextensionid/index.html?surface=tab",
      "chrome-extension://fakeextensionid/index.html?surface=tab&handoff=h1",
    ]);
  });
});

describe("sendMessage", () => {
  it("passes the message through and returns the service worker's reply", async () => {
    const chrome = installFakeChrome();
    const reply = { ok: true, name: "example.com", text: "{}" };
    chrome.runtime.sendMessage.mockResolvedValueOnce(reply);
    expect(await sendMessage({ type: "read-active-tab" })).toEqual(reply);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "read-active-tab",
    });
  });
});
