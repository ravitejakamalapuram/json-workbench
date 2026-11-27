// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { base64url, makeToken } from "./fixtures";
import JwtMode from "./JwtMode";
import { IDLE, jwtState } from "./jwt-state";

const NOW = Date.UTC(2026, 10, 27, 14, 15, 26);
const seconds = NOW / 1000;
const HEADER = { alg: "HS256", typ: "JWT" };
const PAYLOAD = { sub: "42", name: "Ada" };

beforeEach(() => {
  jwtState.setState(IDLE);
  // Only the clock: user-event and Testing Library wait on real timers.
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const input = () => screen.getByTestId<HTMLTextAreaElement>("jwt-input");
const payload = () => screen.getByTestId("jwt-payload");

async function paste(text: string) {
  const user = userEvent.setup();
  await user.click(input());
  await user.paste(text);
  return user;
}

describe("the JWT page", () => {
  it("says plainly that it decodes and does not verify", () => {
    render(<JwtMode />);
    expect(
      screen.getByText(
        "Decoded here, not verified. The signature is not checked.",
      ),
    ).toBeDefined();
    expect(screen.getByLabelText("Paste a token")).toBe(input());
    // Nothing to decode yet, so no empty sections and no error.
    expect(screen.queryByRole("heading", { name: "Payload" })).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("focuses the input, so a paste does not open a document", () => {
    render(<JwtMode />);
    expect(document.activeElement).toBe(input());
  });

  it("does not ask the browser to correct a token", () => {
    render(<JwtMode />);
    expect(input().getAttribute("spellcheck")).toBe("false");
    expect(input().getAttribute("autocomplete")).toBe("off");
  });

  it("decodes the header, payload and signature as the token is pasted", async () => {
    render(<JwtMode />);
    await paste(makeToken(HEADER, PAYLOAD, "c2lnbmF0dXJl"));
    expect(payload().textContent).toBe(JSON.stringify(PAYLOAD, null, 2));
    expect(
      within(screen.getByRole("region", { name: "Header" })).getByText(
        /"alg": "HS256"/,
      ),
    ).toBeDefined();
    expect(
      within(screen.getByRole("region", { name: "Signature" })).getByText(
        "c2lnbmF0dXJl",
      ),
    ).toBeDefined();
  });

  it("keeps number digits as they were written", async () => {
    render(<JwtMode />);
    const token = [
      base64url('{"alg":"HS256"}'),
      base64url('{"id":900719925474099312345}'),
      "sig",
    ].join(".");
    await paste(token);
    expect(payload().textContent).toBe('{\n  "id": 900719925474099312345\n}');
  });

  it("accepts a header line copied with its line breaks", async () => {
    render(<JwtMode />);
    const token = makeToken(HEADER, PAYLOAD);
    await paste(
      `Authorization: Bearer ${token.slice(0, 30)}\n${token.slice(30)}\n`,
    );
    expect(payload().textContent).toBe(JSON.stringify(PAYLOAD, null, 2));
  });

  it("follows the text as it is edited and emptied", async () => {
    render(<JwtMode />);
    const user = await paste(makeToken(HEADER, PAYLOAD));
    await user.clear(input());
    expect(screen.queryByTestId("jwt-payload")).toBeNull();
    await user.paste(makeToken(HEADER, { sub: "other" }));
    expect(payload().textContent).toContain("other");
  });

  // The shell opens any text pasted outside a field as a document, so after a
  // click on a Copy button or on the page, a new token would leave this mode.
  describe("a paste when the box is not focused", () => {
    const clipboard = (text: string) => ({
      clipboardData: { getData: () => text, files: [] },
    });

    it("goes into the box, and the shell is told it was handled", () => {
      render(<JwtMode />);
      const token = makeToken(HEADER, PAYLOAD);
      screen.getByRole("heading", { name: "Decode a token" }).focus();
      const unhandled = fireEvent.paste(document.body, clipboard(token));
      expect(unhandled).toBe(false);
      expect(input().value).toBe(token);
      expect(document.activeElement).toBe(input());
      expect(payload().textContent).toBe(JSON.stringify(PAYLOAD, null, 2));
    });

    it("replaces the token that was there", async () => {
      render(<JwtMode />);
      await paste(makeToken(HEADER, PAYLOAD));
      const next = makeToken(HEADER, { sub: "next" });
      fireEvent.paste(document.body, clipboard(next));
      expect(input().value).toBe(next);
    });

    it("leaves a paste into another field, a dialog or an empty clipboard alone", () => {
      render(
        <>
          <JwtMode />
          <input aria-label="Other" />
        </>,
      );
      const token = makeToken(HEADER, PAYLOAD);
      expect(
        fireEvent.paste(screen.getByLabelText("Other"), clipboard(token)),
      ).toBe(true);
      fireEvent.paste(document.body, clipboard(""));
      const dialog = document.body.appendChild(document.createElement("div"));
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      expect(fireEvent.paste(dialog, clipboard(token))).toBe(true);
      dialog.remove();
      expect(input().value).toBe("");
    });

    it("stops listening when the page is closed", () => {
      const { unmount } = render(<JwtMode />);
      unmount();
      expect(
        fireEvent.paste(document.body, clipboard(makeToken(HEADER, PAYLOAD))),
      ).toBe(true);
      expect(jwtState.getState().token).toBe("");
    });
  });

  describe("time claims", () => {
    it("shows a date, an ISO time and how long ago, and an Expired badge", async () => {
      render(<JwtMode />);
      await paste(
        makeToken(HEADER, {
          iat: seconds - 4 * 86400,
          exp: seconds - 3 * 86400,
        }),
      );
      const claims = screen.getByRole("region", { name: "Claims" });
      expect(within(claims).getByText("Expired")).toBeDefined();
      expect(within(claims).getByText(/expired 3 days ago/)).toBeDefined();
      expect(
        within(claims).getByText(/2026-11-24T14:15:26.000Z/),
      ).toBeDefined();
      expect(within(claims).getByText(/issued 4 days ago/)).toBeDefined();
    });

    it("keeps the time current while the page stays open", async () => {
      render(<JwtMode />);
      await paste(makeToken(HEADER, { exp: seconds + 45 }));
      const claims = () => screen.getByRole("region", { name: "Claims" });
      expect(within(claims()).getByText(/expires in 45 seconds/)).toBeDefined();
      expect(within(claims()).queryByText("Expired")).toBeNull();
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(
        within(claims()).getByText(/expired 15 seconds ago/),
      ).toBeDefined();
      expect(within(claims()).getByText("Expired")).toBeDefined();
    });

    it("has no Expired badge while the token is still good", async () => {
      render(<JwtMode />);
      await paste(makeToken(HEADER, { exp: seconds + 2 * 3600 }));
      const claims = screen.getByRole("region", { name: "Claims" });
      expect(within(claims).getByText(/expires in 2 hours/)).toBeDefined();
      expect(within(claims).queryByText("Expired")).toBeNull();
    });

    it("says when a time claim is not a time", async () => {
      render(<JwtMode />);
      await paste(makeToken(HEADER, { exp: "tomorrow" }));
      const claims = screen.getByRole("region", { name: "Claims" });
      expect(within(claims).getByText("Not a valid time")).toBeDefined();
      expect(within(claims).queryByText("Expired")).toBeNull();
    });

    it("has no Claims section without a time claim", async () => {
      render(<JwtMode />);
      await paste(makeToken(HEADER, PAYLOAD));
      expect(screen.queryByRole("region", { name: "Claims" })).toBeNull();
    });
  });

  describe("unsigned tokens", () => {
    it.each(["none", "None", "NONE"])("notes alg %s quietly", async (alg) => {
      render(<JwtMode />);
      await paste(makeToken({ alg }, PAYLOAD, ""));
      expect(screen.getByText(/This token is unsigned/)).toBeDefined();
      expect(screen.getByText("No signature.")).toBeDefined();
    });

    it("does not take an alg that is not in the header from its prototype", async () => {
      render(<JwtMode />);
      const token = [
        base64url('{"__proto__":{"alg":"none"},"typ":"JWT"}'),
        base64url("{}"),
        "c2ln",
      ].join(".");
      await paste(token);
      expect(screen.queryByText(/This token is unsigned/)).toBeNull();
    });

    it("does not note a signed token", async () => {
      render(<JwtMode />);
      await paste(makeToken(HEADER, PAYLOAD));
      expect(screen.queryByText(/This token is unsigned/)).toBeNull();
    });
  });

  describe("problems", () => {
    it("says how many parts the token has", async () => {
      render(<JwtMode />);
      const [header, body] = makeToken(HEADER, PAYLOAD).split(".");
      await paste(`${header}.${body}`);
      expect(screen.getByRole("status").textContent).toBe(
        "A token has 3 parts separated by dots; this one has 2.",
      );
      expect(input().getAttribute("aria-invalid")).toBe("true");
      expect(screen.queryByTestId("jwt-payload")).toBeNull();
    });

    it("speaks through a status region that was in the page before the text", async () => {
      render(<JwtMode />);
      // A screen reader announces text that changes in a live region, not one
      // that arrives with it, so the same element has to take the message.
      const status = screen.getByRole("status");
      await paste("only.two");
      expect(screen.getByRole("status")).toBe(status);
      expect(status.textContent).toContain("3 parts");
      expect(status.querySelector("#jwt-problem")?.textContent).toContain(
        "3 parts",
      );
      expect(input().getAttribute("aria-describedby")).toContain("jwt-problem");
    });

    it("names the part that is not base64url", async () => {
      render(<JwtMode />);
      await paste(`${base64url("{}")}.not base64!.sig`);
      expect(screen.getByRole("status").textContent).toBe(
        "The payload is not valid base64url.",
      );
    });

    it("shows what a part decoded to when it is not JSON", async () => {
      render(<JwtMode />);
      await paste(
        [base64url("{}"), base64url("hello, world"), "sig"].join("."),
      );
      expect(screen.getByRole("status").textContent).toBe(
        "The payload decoded, but it is not JSON.",
      );
      expect(
        screen.getByRole("region", { name: "Decoded text" }).textContent,
      ).toContain("hello, world");
    });

    it("clears the problem once the token is whole", async () => {
      render(<JwtMode />);
      const user = await paste("only.two");
      expect(screen.getByRole("status").textContent).not.toBe("");
      await user.clear(input());
      await user.paste(makeToken(HEADER, PAYLOAD));
      expect(screen.getByRole("status").textContent).toBe("");
      expect(input().getAttribute("aria-invalid")).toBeNull();
    });
  });

  describe("Copy", () => {
    it("copies the header, the payload and the signature", async () => {
      render(<JwtMode />);
      const user = await paste(makeToken(HEADER, PAYLOAD, "c2ln"));
      await user.click(screen.getByRole("button", { name: "Copy payload" }));
      expect(await navigator.clipboard.readText()).toBe(
        JSON.stringify(PAYLOAD, null, 2),
      );
      await user.click(screen.getByRole("button", { name: "Copy header" }));
      expect(await navigator.clipboard.readText()).toBe(
        JSON.stringify(HEADER, null, 2),
      );
      await user.click(screen.getByRole("button", { name: "Copy signature" }));
      expect(await navigator.clipboard.readText()).toBe("c2ln");
    });

    it("says so when the clipboard refuses", async () => {
      render(<JwtMode />);
      const user = await paste(makeToken(HEADER, PAYLOAD));
      vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(
        new Error("denied"),
      );
      await user.click(screen.getByRole("button", { name: "Copy payload" }));
      expect(
        await screen.findByText("Could not copy to the clipboard"),
      ).toBeDefined();
      expect(
        screen.getByRole("button", { name: "Copy payload" }).textContent,
      ).toBe("Copy failed");
    });

    it("confirms the copy", async () => {
      render(<JwtMode />);
      const user = await paste(makeToken(HEADER, PAYLOAD));
      await user.click(screen.getByRole("button", { name: "Copy payload" }));
      expect(await screen.findByText("Copied to the clipboard")).toBeDefined();
    });
  });

  describe("Clear", () => {
    it("empties the token and returns focus to the input", async () => {
      render(<JwtMode />);
      const user = await paste(makeToken(HEADER, PAYLOAD));
      await user.click(screen.getByRole("button", { name: "Clear" }));
      expect(input().value).toBe("");
      expect(document.activeElement).toBe(input());
      expect(screen.queryByTestId("jwt-payload")).toBeNull();
      expect(
        screen.getByRole("button", { name: "Clear" }).hasAttribute("disabled"),
      ).toBe(true);
      expect(jwtState.getState().token).toBe("");
    });
  });

  describe("opened from the tree", () => {
    it("starts with the token it was given", () => {
      jwtState.setState({ token: makeToken(HEADER, PAYLOAD) });
      render(<JwtMode />);
      expect(input().value).toBe(makeToken(HEADER, PAYLOAD));
      expect(payload().textContent).toBe(JSON.stringify(PAYLOAD, null, 2));
    });

    it("says why there is no token when it could not be read", () => {
      jwtState.setState({ notice: "This string is too large to decode here." });
      render(<JwtMode />);
      expect(screen.getByRole("status").textContent).toBe(
        "This string is too large to decode here.",
      );
    });
  });

  describe("a payload nested past what a value can be read at", () => {
    // 3,000 levels would indent into tens of MB, and the parser stops at 1,000.
    it("says so, with the limit", async () => {
      render(<JwtMode />);
      const nested = `{"a":${"[".repeat(3000)}${"]".repeat(3000)}}`;
      await paste([base64url("{}"), base64url(nested), "c2ln"].join("."));
      expect(screen.getByRole("status").textContent).toBe(
        "The payload decoded, but it is nested too deeply (limit 1,000 levels).",
      );
    });
  });

  describe("privacy and safety", () => {
    it("renders a claim that looks like HTML as text", async () => {
      const { container } = render(<JwtMode />);
      const claim = "<img src=x onerror=alert(1)>";
      await paste(makeToken(HEADER, { name: claim }));
      expect(payload().textContent).toContain(claim);
      expect(container.querySelector("img")).toBeNull();
    });

    it("stores nothing and puts nothing in the address", async () => {
      const address = location.href;
      render(<JwtMode />);
      await paste(makeToken(HEADER, PAYLOAD));
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
      expect(location.href).toBe(address);
    });
  });
});
