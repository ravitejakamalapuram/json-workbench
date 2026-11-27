# ADR 0005: Read tabs through scripting and a DevTools panel; drop the debugger and the credentialed re-fetch

## Status

Accepted (2026-11-27). Decisions 11 and 12 in `docs/design/DECISIONS.md`.

## Context

The shipped service worker (`apps/extension/background.js`, 263 lines of plain JS) had two ways to get JSON from a page:

- "Active JSON tab" requested the tab's URL again with `fetch(url, { credentials: "include" })`. The response matched the page, but the action sent a second authenticated request to whatever the user was looking at; an endpoint that changes state on GET changed it twice. It also needed the extension to hold network capability in the service worker.
- "Capture next JSON response" attached `chrome.debugger` to the tab and read a response body through the DevTools protocol. Chrome shows one of its strongest warnings when `debugger` is requested, even as an optional permission, and a "started debugging this browser" banner on every attached tab.

Both are hard to explain in a privacy policy whose promise is "your JSON never leaves the device".

## Decision

- "Import active tab" runs `chrome.scripting.executeScript` in the active tab of the last focused normal window (granted by `activeTab` after a toolbar click, or by a host grant). The injected function returns the original text the content script kept in `globalThis.__jsonWorkbenchSource`, else the `<pre>` element's `textContent`, and refuses text above `LIMITS.activeTabBytes` from inside the page. No re-fetch, no cookies, no network access in the service worker.
- Network bodies come from a DevTools panel (`devtools_page: devtools.html`). The panel registers `chrome.devtools.network.onRequestFinished` only while it is shown, keeps `{url without query, status, mimeType, size}` and the `getContent` closure (never a HAR entry, which carries `Cookie`, `Authorization` and `Set-Cookie`), and opens a chosen body in the panel itself.
- The manifest drops `debugger` entirely: no required or optional `debugger`, no `tabs`, no `host_permissions`. Host access is optional (`<all_urls>`), requested from a click per origin ("Allow on this site") or for all sites ("Auto-render on all pages").
- Messages carry no tab id; the service worker decides which tab it reads. Senders are classified by `sender.url` (an extension page has a `chrome-extension://<id>/` URL), not by `sender.tab`, because Chrome also sets `sender.tab` for the full-tab workbench.

## Consequences

- The extension's permission prompt shrinks to activeTab, side panel, storage and scripting. `.appforge/permissions.yaml` and `PRIVACY.md` are updated in the same change; `scripts/lib/manifest-policy.mjs` fails the package check if `debugger`, `optional_permissions` or `host_permissions` come back.
- Rendered text is what the browser displays. Big numbers survive because they are read as text and parsed losslessly, but this has to be proven: the tabimport item tests a fixture with `900719925474099312345`, NBSP, U+2028 and a tab inside strings. If the rendered path ever loses fidelity, the fallback is "Open the file or paste", never a network call.
- Large bodies may regress. The debugger path could raise buffer limits and the DevTools API cannot; the first build measured a 64 MiB ceiling on the encoded `sendMessage` reply (so `activeTabBytes` is 32 MiB) and 10 MiB of UTF-8 in `storage.session` (so the in-page handoff is 8 MiB). `getContent`'s ceiling is not measured yet.
- Playwright cannot open the side panel or DevTools, so these paths are on the tabimport item's manual pre-release checklist.
