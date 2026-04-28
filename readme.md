# Focus platform

Focus is a local-first, end-to-end encrypted activity tracking platform that merges desktop, browser, and mobile activity into one timeline.

## Implemented components

| Component | Path | What it does |
| --- | --- | --- |
| Shared contracts | `packages/shared` | Shared event/session models, category rules, focus score helpers |
| Sync service | `services/sync-server` | SQLite-backed REST + WebSocket sync (`/v1/sync/push`, `/v1/sync/pull`, `/v1/sync/status`, `/v1/realtime`) |
| Desktop app (Tauri) | `apps/desktop` | Active-window tracking (5s sampling), idle pause, local SQLite, encrypted sync, dashboard UI, settings/focus mode |
| Web dashboard | `apps/dashboard` | React dashboard that decrypts pulled events client-side and renders timeline/charts/stats |
| Browser extension | `apps/browser-extension` | URL/title/time-on-tab tracking, local IndexedDB queue, realtime + batch encrypted sync |
| iOS app | `apps/mobile-ios` | SwiftUI app with local SQLite, unlock events, manual tagging, foreground usage ingestion hook, encrypted sync client |
| Android app | `apps/mobile-android` | Kotlin/Compose app with Room DB, UsageStats ingestion, unlock events, manual tags, encrypted sync client |

## Core product behavior

1. **Data collection**
   - Desktop: active app/window title sampling, idle detection.
   - Browser extension: active tab URL/title and session durations.
   - Mobile: usage snapshots + unlock events + manual tags.
2. **Sync**
   - Local-first writes on every client.
   - Ciphertext-only payload handling on server.
   - Realtime socket notifications when available, periodic batch fallback.
3. **Dashboard**
   - Unified timeline rows by device.
   - Top apps/sites chart.
   - Weekly trend + focus score.
   - Stats cards and sync status indicators.
   - Settings for goals, exclusions, schedule/focus controls.

## Workspace scripts

From repository root:

- `npm install`
- `npm run typecheck`
- `npm run build`
- `npm run dev:sync`
- `npm run dev:desktop`
- `npm run dev:dashboard`

See `setup.md` for full per-platform setup, native prerequisites, and mobile entitlement notes.
