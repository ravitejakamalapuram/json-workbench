// Service worker for the first release, built by esbuild to dist/background.js.
// It only keeps the toolbar icon opening the side panel and handles no messages.
// Tab import (TARGET.md section 3.6) is not part of this release.
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
