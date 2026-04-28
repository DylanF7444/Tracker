import cors from "cors";
import express from "express";
import helmet from "helmet";
import http from "node:http";
import {
  insertSyncEvent,
  selectDeviceStatusByUser,
  selectEventsSinceCursor,
  selectLatestCursorByUser,
  upsertDeviceStatus
} from "./db.js";
import { setupRealtimeServer } from "./realtime.js";
import { pullQuerySchema, pushSchema, statusQuerySchema } from "./schema.js";

const app = express();
const server = http.createServer(app);
const realtime = setupRealtimeServer(server);

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "focus-sync-server" });
});

app.post("/v1/sync/push", (req, res) => {
  const parsed = pushSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid push payload", details: parsed.error.flatten() });
  }

  const { userId, deviceId, deviceType, events } = parsed.data;
  const now = new Date().toISOString();
  let accepted = 0;

  for (const event of events) {
    const result = insertSyncEvent.run(
      event.eventId,
      userId,
      event.sourceDeviceId,
      event.sourceDeviceType,
      event.startTs,
      event.endTs,
      JSON.stringify(event.envelope),
      now
    );
    if (result.changes > 0) accepted += 1;
  }

  upsertDeviceStatus.run(deviceId, userId, deviceType, 1, now, now);
  const latestCursor = (selectLatestCursorByUser.get(userId) as { cursor: number }).cursor;

  if (accepted > 0) {
    realtime.notifyUser(userId, { type: "sync-event", cursor: latestCursor, accepted });
  }

  return res.json({ accepted, cursor: latestCursor });
});

app.get("/v1/sync/pull", (req, res) => {
  const parsed = pullQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid pull query", details: parsed.error.flatten() });
  }

  const { userId, deviceId, deviceType, sinceCursor, limit } = parsed.data;
  const now = new Date().toISOString();
  const rows = selectEventsSinceCursor.all(userId, sinceCursor, deviceId, limit) as Array<{
    cursor: number;
    event_id: string;
    source_device_id: string;
    source_device_type: "desktop" | "mobile" | "browser";
    start_ts: string;
    end_ts: string;
    payload_json: string;
  }>;

  const events = rows.map((row) => ({
    cursor: row.cursor,
    eventId: row.event_id,
    sourceDeviceId: row.source_device_id,
    sourceDeviceType: row.source_device_type,
    startTs: row.start_ts,
    endTs: row.end_ts,
    envelope: JSON.parse(row.payload_json)
  }));

  const cursor = rows.length > 0 ? rows[rows.length - 1].cursor : sinceCursor;
  upsertDeviceStatus.run(deviceId, userId, deviceType, 1, now, now);

  return res.json({ events, cursor });
});

app.get("/v1/sync/status", (req, res) => {
  const parsed = statusQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid status query", details: parsed.error.flatten() });
  }
  const rows = selectDeviceStatusByUser.all(parsed.data.userId) as Array<{
    user_id: string;
    device_id: string;
    device_type: "desktop" | "mobile" | "browser";
    online: number;
    last_seen_at: string;
    last_sync_at: string;
  }>;

  const devices = rows.map((row) => ({
    userId: row.user_id,
    deviceId: row.device_id,
    deviceType: row.device_type,
    online: row.online === 1,
    lastSeenAt: row.last_seen_at,
    lastSyncAt: row.last_sync_at
  }));

  return res.json({ devices });
});

const PORT = Number(process.env.PORT ?? 8787);
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Focus sync server listening on http://localhost:${PORT}`);
});
