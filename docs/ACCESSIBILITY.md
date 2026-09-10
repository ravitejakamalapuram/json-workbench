# Accessibility audit

The extension UI is designed for keyboard-first use in the Chrome side panel.
The release gate covers the following behaviors:

- all actions are native buttons or form controls and are reachable with Tab;
- the tree uses `role=tree`/`role=treeitem`, `aria-level`, and expandable nodes
  expose `aria-expanded`;
- search, SQL, schema, assistant, and pipeline configuration editors have
  accessible labels;
- status changes use a polite live region, and icon-only actions have labels;
- visible focus rings are preserved in both themes;
- reduced-motion preferences disable non-essential animation and scrolling;
- table headers and result structure remain semantic HTML.

The browser smoke test exercises keyboard-visible controls, tree expansion,
search, raw editor, SQL, JSONL, and malformed-input paths. Before publishing,
run it in Chromium with `python3 tests/smoke_extension.py` and manually verify
screen-reader announcements in the target Chrome side panel because browser
extension host rendering is not fully reproduced by headless HTTP smoke tests.
