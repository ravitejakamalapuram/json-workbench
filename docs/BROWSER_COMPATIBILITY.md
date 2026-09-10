# Browser compatibility

| Browser     | Supported surface                                               | Validation                                                        |
| ----------- | --------------------------------------------------------------- | ----------------------------------------------------------------- |
| Chrome 120+ | Side panel, MV3 worker, local DuckDB, optional response capture | Chromium Playwright smoke and packaged extension review           |
| Edge 120+   | MV3 extension UI and local processing                           | Chromium-compatible target; validate store install before release |
| Firefox     | Not a supported release target                                  | MV3 side-panel and debugger behavior differ                       |
| Safari      | Not a supported release target                                  | Extension packaging and DuckDB worker routing differ              |

The application has no remote API dependency. DuckDB and jq workers are copied
into the package so production requests remain local and do not depend on a
CDN or network availability.
