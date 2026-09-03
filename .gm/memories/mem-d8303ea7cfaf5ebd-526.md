---
key: mem-d8303ea7cfaf5ebd-526
ns: default
created: 1786108579194
updated: 1786108579194
---

thebird+design LIVE/status color split (2026-08-06): .chip.tone-live / .ds-badge.tone-live / .ds-dot-live use --sky (#3A6EFF) instead of the tone-ok/tone-success green group, so a LIVE indicator is never visually identical to a generic success state. Fixed in anentrypoint-design's primitives.css/hero-content.css/atoms.js, consumed by thebird via refresh-design.mjs. freddie-dashboard.js's LIVE crumb chip and pages-telemetry.js's live-connection chip were updated from tone:'ok' to tone:'live' to actually consume the split.
