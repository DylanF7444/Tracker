# Setup guide

## Development protocol
- Treat the Tauri desktop app (`apps/desktop`) as the primary product UI for new features and fixes.
- Mirror changes into the web dashboard only when the feature is explicitly needed there.

## 1. Prerequisites

### Required for all
- Node.js 24+
- npm 11+

### Desktop (Tauri)
- Rust toolchain (`rustup`, `cargo`)
- Windows: WebView2 runtime (normally preinstalled on Windows 11)

### iOS
- Xcode 16+
- Apple developer account for Screen Time/Family Controls entitlements

### Android
- Android Studio (latest stable)
- Android SDK 35

## 2. Install workspace dependencies

```bash
npm install
```

## 3. Start the sync backend

```bash
npm run dev:sync
```

Server base URL: `http://localhost:8787`

Health check:

```bash
curl http://localhost:8787/health
```

## 4. Run desktop app (Tauri)

```bash
npm run dev:desktop
```

Desktop app details:
- Local DB: `apps/desktop/src-tauri/data/focus-desktop.db`
- Tauri commands exposed for UI:
  - `start_tracking`
  - `stop_tracking`
  - `ingest_browser_event`
  - `manual_tag_session`
  - `sync_now`
  - `get_dashboard_snapshot`
  - `get_settings` / `save_settings`

## 5. Run web dashboard

```bash
npm run dev:dashboard
```

In the dashboard UI set:
- Server URL: `http://localhost:8787`
- User ID: `demo-user` (or your configured user)
- Encryption key: same key used by your clients

## 6. Load browser extension

1. Open Chromium/Chrome `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `apps/browser-extension`.
5. Open extension settings and set:
   - Server URL
   - User ID
   - Device ID
   - Encryption key

## 7. iOS app setup

Project source is in `apps/mobile-ios/FocusMobile/FocusMobile`.

1. Create/open an iOS App project in Xcode named **FocusMobile**.
2. Add all Swift files from that folder to the app target.
3. Link frameworks:
   - `CryptoKit`
   - `DeviceActivity`
   - `FamilyControls` (if using Screen Time APIs)
   - `SQLite3`
4. Configure signing/team.
5. Build and run on device.

Screen Time notes:
- Full per-app Screen Time access requires special Apple entitlements and a report extension target.
- The provided collector has extension ingestion hooks plus unlock/manual session capture.

## 8. Android app setup

Project source is in `apps/mobile-android`.

1. Open `apps/mobile-android` in Android Studio.
2. Sync Gradle.
3. Ensure SDK 35 is installed.
4. Run app on emulator/device.
5. Grant Usage Access for the app in Android settings.

For emulator backend access, default server URL is `http://10.0.2.2:8787`.

## 9. Sync and encryption alignment

All clients must share:
- the same `userId`
- a unique `deviceId` per device
- the same `encryptionKey`
- the same sync server URL

The server stores only encrypted envelopes and metadata.

## 10. Build commands

```bash
npm run typecheck
npm run build
```

Optional native validation:

```bash
cd apps/desktop/src-tauri
cargo check
```
