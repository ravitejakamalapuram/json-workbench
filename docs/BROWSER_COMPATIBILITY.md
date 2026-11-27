# Browser compatibility

| Browser     | Supported surface                                          | Validation                                                        |
| ----------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| Chrome 120+ | Side panel, MV3 service worker, local tree, raw and export | Chromium Playwright smoke and packaged extension review           |
| Edge 120+   | MV3 extension UI and local processing                      | Chromium-compatible target; validate store install before release |
| Firefox     | Not a supported release target                             | MV3 side-panel behavior differs                                   |
| Safari      | Not a supported release target                             | Extension packaging differs                                       |

The application has no remote API dependency and the package holds no
WebAssembly file, so it works offline.
