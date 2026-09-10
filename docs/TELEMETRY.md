# Opt-in telemetry design

Telemetry is intentionally not enabled in the current release. If product
analytics are added later, the design must preserve the local-first contract:

- default is off and no event is sent before explicit consent;
- never collect source JSON, query text, paths, file names, pipeline contents,
  response bodies, or clipboard data;
- allowed aggregate events are anonymous feature counts, duration buckets,
  parser/worker error classes, and extension version;
- consent, endpoint, retention, and deletion controls are documented before
  implementation;
- events are queued in memory only, use a bounded batch, and are dropped when
  offline or when consent is revoked;
- error reporting must redact exception messages before transport and provide a
  local-only mode for regulated environments.

Any implementation requires a separate review of the privacy policy, manifest
permissions, threat model, and store disclosure before being enabled.
