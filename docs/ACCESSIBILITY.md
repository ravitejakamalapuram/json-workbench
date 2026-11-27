# Accessibility audit

The extension UI is designed for keyboard-first use in the Chrome side panel.
The release gate covers the following behaviors:

- all actions are native buttons or form controls and are reachable with Tab;
- the tree uses `role=tree`/`role=treeitem`, `aria-level`, and expandable nodes
  expose `aria-expanded`;
- the tree search, command palette, details panel, Raw editor, settings,
  JWT and YAML controls have accessible labels;
- status changes use a polite live region, and icon-only actions have labels;
- visible focus rings are preserved in both themes;
- reduced-motion preferences disable non-essential animation and scrolling.

Automated coverage: `tests/smoke_extension.py` checks the manifest, the CSP,
that every mode and view mounts without a console error, and that the 400 px
side panel has no overflowing control; `tests/acceptance_extension.py` covers
tree expansion and search, the Raw error fix, export and the dark theme. The
component tests cover keyboard paths. Focus order and screen-reader
announcements are checked by hand in the Chrome side panel before publishing;
no script does that.
