# Copilot instructions

## Commands
- `npm install`
- `npm run typecheck`
- `npm run build`
- `npm run lint`
- `npm run dev:sync` (sync server on `http://localhost:8787`, health: `/health`)
- `npm run dev:desktop`
- `npm run dev:dashboard`

## High-level architecture
- Monorepo with npm workspaces: `apps/*` (clients), `services/*` (backend), `packages/*` (shared).
- `packages/shared` defines core domain contracts and helpers (activity/session types, `EncryptedEnvelope`, `classifyActivity`, focus score).
- `services/sync-server` is an Express + WebSocket service that exposes `/v1/sync/push`, `/v1/sync/pull`, `/v1/sync/status`, and `/v1/realtime`, persisting encrypted event envelopes and device status to SQLite (`services/sync-server/data/sync.db`).
- Client apps:
  - `apps/desktop`: Tauri desktop tracker with local SQLite and sync client.
  - `apps/dashboard`: React/Vite dashboard that decrypts and renders timelines/charts client-side.
  - `apps/browser-extension`: browser activity capture with local IndexedDB queue + encrypted sync.
  - `apps/mobile-ios` and `apps/mobile-android`: native collectors with encrypted sync clients.

## Key conventions
- Sync payloads use `EncryptedEnvelope` `{ version: 1, alg: "aes-256-gcm", nonce, ciphertext }`; the server validates shape with Zod and stores the JSON verbatim.
- Sync is cursor-based: push responses return `cursor`; pull uses `sinceCursor` and `limit` (default 500, max 5000) and excludes events from the requesting `deviceId`.
- Device identity is always `userId` + `deviceId` + `deviceType`; timestamps are ISO strings (validated with Zod `datetime()`).
- Activity classification uses `CategoryRule.appliesTo` (`app` | `domain` | `title`) with normalized (trim/lowercase) matching; defaults live in `DEFAULT_CATEGORY_RULES`.
