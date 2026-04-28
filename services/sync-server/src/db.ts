import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "sync.db");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
CREATE TABLE IF NOT EXISTS sync_events (
  cursor INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  source_device_id TEXT NOT NULL,
  source_device_type TEXT NOT NULL,
  start_ts TEXT NOT NULL,
  end_ts TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_status (
  device_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_type TEXT NOT NULL,
  online INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT NOT NULL,
  last_sync_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_events_user_cursor
ON sync_events(user_id, cursor);
`);

export const insertSyncEvent = db.prepare(`
INSERT OR IGNORE INTO sync_events (
  event_id,
  user_id,
  source_device_id,
  source_device_type,
  start_ts,
  end_ts,
  payload_json,
  created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

export const upsertDeviceStatus = db.prepare(`
INSERT INTO device_status (
  device_id,
  user_id,
  device_type,
  online,
  last_seen_at,
  last_sync_at
) VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(device_id) DO UPDATE SET
  user_id = excluded.user_id,
  device_type = excluded.device_type,
  online = excluded.online,
  last_seen_at = excluded.last_seen_at,
  last_sync_at = excluded.last_sync_at
`);

export const updateDeviceOnline = db.prepare(`
UPDATE device_status
SET online = ?, last_seen_at = ?
WHERE device_id = ?
`);

export const selectEventsSinceCursor = db.prepare(`
SELECT cursor, event_id, source_device_id, source_device_type, start_ts, end_ts, payload_json
FROM sync_events
WHERE user_id = ? AND cursor > ? AND source_device_id != ?
ORDER BY cursor ASC
LIMIT ?
`);

export const selectLatestCursorByUser = db.prepare(`
SELECT COALESCE(MAX(cursor), 0) AS cursor
FROM sync_events
WHERE user_id = ?
`);

export const selectDeviceStatusByUser = db.prepare(`
SELECT user_id, device_id, device_type, online, last_seen_at, last_sync_at
FROM device_status
WHERE user_id = ?
ORDER BY last_seen_at DESC
`);
