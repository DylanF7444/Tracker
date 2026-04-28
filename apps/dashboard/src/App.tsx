import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type SyncEvent = {
  eventId: string;
  envelope: {
    version: 1;
    alg: "aes-256-gcm";
    nonce: string;
    ciphertext: string;
  };
};

type ActivitySession = {
  id: string;
  deviceType: "desktop" | "mobile" | "browser";
  deviceId: string;
  appName: string;
  pageUrl: string;
  category: string;
  productivity: string;
  tag: string;
  startTs: string;
  endTs: string;
  source: string;
};

async function deriveKey(secret: string): Promise<CryptoKey> {
  const data = new TextEncoder().encode(secret);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["decrypt"]);
}

function decodeBase64(value: string): Uint8Array {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

async function decryptEnvelope(secret: string, event: SyncEvent): Promise<ActivitySession> {
  const key = await deriveKey(secret);
  const nonceBytes = decodeBase64(event.envelope.nonce);
  const cipherBytes = decodeBase64(event.envelope.ciphertext);
  const iv = toArrayBuffer(nonceBytes);
  const ciphertext = toArrayBuffer(cipherBytes);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  const json = new TextDecoder().decode(new Uint8Array(plaintext));
  return JSON.parse(json) as ActivitySession;
}

function minutesBetween(startTs: string, endTs: string): number {
  return Math.max(0, Math.round((new Date(endTs).getTime() - new Date(startTs).getTime()) / 60000));
}

export default function App() {
  const [serverUrl, setServerUrl] = useState("http://localhost:8787");
  const [userId, setUserId] = useState("demo-user");
  const [deviceId] = useState("dashboard-viewer");
  const [encryptionKey, setEncryptionKey] = useState("change-this-encryption-key");
  const [sessions, setSessions] = useState<ActivitySession[]>([]);
  const [status, setStatus] = useState("Ready");
  const [syncState, setSyncState] = useState("unknown");

  const topUsage = useMemo(() => {
    const map = new Map<string, number>();
    for (const session of sessions) {
      let key = session.appName;
      if (session.pageUrl) {
        try {
          key = new URL(session.pageUrl).hostname;
        } catch {
          key = session.pageUrl;
        }
      }
      map.set(key, (map.get(key) ?? 0) + minutesBetween(session.startTs, session.endTs));
    }
    return [...map.entries()]
      .map(([name, minutes]) => ({ name, minutes }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 10);
  }, [sessions]);

  const weeklyTrend = useMemo(() => {
    const map = new Map<string, { productive: number; distracting: number }>();
    for (const session of sessions) {
      const day = new Date(session.startTs).toISOString().slice(5, 10);
      const value = map.get(day) ?? { productive: 0, distracting: 0 };
      const minutes = minutesBetween(session.startTs, session.endTs);
      if (session.productivity === "productive") value.productive += minutes;
      if (session.productivity === "distracting") value.distracting += minutes;
      map.set(day, value);
    }
    return [...map.entries()].map(([day, value]) => {
      const total = value.productive + value.distracting;
      const focusScore = total === 0 ? 50 : Math.round((value.productive / total) * 100);
      return { day, focusScore };
    });
  }, [sessions]);

  const timelineRows = useMemo(() => {
    const map = new Map<string, ActivitySession[]>();
    for (const session of sessions) {
      const key = `${session.deviceType}:${session.deviceId}`;
      const list = map.get(key) ?? [];
      list.push(session);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [sessions]);

  async function load() {
    setStatus("Syncing...");
    const base = serverUrl.replace(/\/$/, "");

    const [pullRes, statusRes] = await Promise.all([
      fetch(
        `${base}/v1/sync/pull?userId=${encodeURIComponent(userId)}&deviceId=${encodeURIComponent(deviceId)}&deviceType=desktop&sinceCursor=0&limit=5000`
      ),
      fetch(`${base}/v1/sync/status?userId=${encodeURIComponent(userId)}`)
    ]);
    const pullBody = (await pullRes.json()) as { events: SyncEvent[] };
    const statusBody = (await statusRes.json()) as { devices: Array<{ deviceType: string; online: boolean }> };

    const decrypted = await Promise.all(pullBody.events.map((event) => decryptEnvelope(encryptionKey, event)));
    decrypted.sort((a, b) => a.startTs.localeCompare(b.startTs));
    setSessions(decrypted);

    const mobileOnline = statusBody.devices.some((device) => device.deviceType === "mobile" && device.online);
    setSyncState(mobileOnline ? "All devices synced" : "Phone offline");
    setStatus(`Loaded ${decrypted.length} sessions`);
  }

  const totalMinutes = sessions.reduce((acc, session) => acc + minutesBetween(session.startTs, session.endTs), 0);
  const deepFocusMinutes = sessions
    .filter((session) => session.tag.toLowerCase() === "deep work" || session.productivity === "productive")
    .reduce((acc, session) => acc + minutesBetween(session.startTs, session.endTs), 0);

  return (
    <div className="layout">
      <header>
        <h1>Focus Dashboard</h1>
        <div className="chips">
          <span>{syncState}</span>
          <span>{status}</span>
        </div>
      </header>

      <section className="controls">
        <label>
          Server URL
          <input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} />
        </label>
        <label>
          User ID
          <input value={userId} onChange={(event) => setUserId(event.target.value)} />
        </label>
        <label>
          Encryption key
          <input value={encryptionKey} onChange={(event) => setEncryptionKey(event.target.value)} />
        </label>
        <button type="button" onClick={load}>
          Refresh data
        </button>
      </section>

      <section className="stats">
        <article>
          <h2>Total screen time</h2>
          <p>{Math.floor(totalMinutes / 60)}h {totalMinutes % 60}m</p>
        </article>
        <article>
          <h2>Deep focus</h2>
          <p>{Math.floor(deepFocusMinutes / 60)}h {deepFocusMinutes % 60}m</p>
        </article>
        <article>
          <h2>Top app/site</h2>
          <p>{topUsage[0]?.name ?? "-"}</p>
        </article>
        <article>
          <h2>Phone pickups</h2>
          <p>{sessions.filter((s) => s.deviceType === "mobile" && s.appName === "Unlock Event").length}</p>
        </article>
      </section>

      <section className="timeline">
        <h2>Unified day timeline</h2>
        {timelineRows.map(([key, value]) => (
          <div key={key} className="timeline-row">
            <div className="label">{key}</div>
            <div className="segments">
              {value.map((session) => {
                const start = new Date(session.startTs);
                const end = new Date(session.endTs);
                const dayStart = new Date(start);
                dayStart.setHours(0, 0, 0, 0);
                const left = ((start.getTime() - dayStart.getTime()) / (24 * 60 * 60 * 1000)) * 100;
                const width = Math.max(0.7, ((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) * 100);
                return (
                  <span
                    key={session.id}
                    className={`segment ${session.category}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={`${session.appName || session.pageUrl} (${start.toLocaleTimeString()}-${end.toLocaleTimeString()})`}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </section>

      <section className="charts">
        <article>
          <h2>Top apps & sites</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={topUsage}>
              <CartesianGrid strokeDasharray="4 4" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="minutes" fill="#2563eb" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </article>
        <article>
          <h2>Weekly focus trend</h2>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={weeklyTrend}>
              <CartesianGrid strokeDasharray="4 4" />
              <XAxis dataKey="day" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="focusScore" stroke="#16a34a" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </article>
      </section>
    </div>
  );
}
