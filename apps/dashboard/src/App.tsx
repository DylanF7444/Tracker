import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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

type UsageIcon = {
  kind: "favicon" | "emoji";
  value: string;
};

type UsageEntry = {
  id: string;
  name: string;
  label: string;
  minutes: number;
  icon: UsageIcon;
  kind: "app" | "site";
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

const DAY_MS = 24 * 60 * 60 * 1000;

function toDayStartMs(date: Date): number {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

function sessionOverlapsDay(session: ActivitySession, dayStartMs: number): boolean {
  const start = new Date(session.startTs).getTime();
  const end = new Date(session.endTs).getTime();
  const dayEndMs = dayStartMs + DAY_MS;
  return end > dayStartMs && start < dayEndMs;
}

function clampSessionToDay(session: ActivitySession, dayStartMs: number): { left: number; width: number } {
  const start = new Date(session.startTs).getTime();
  const end = new Date(session.endTs).getTime();
  const dayEndMs = dayStartMs + DAY_MS;
  const clampedStart = Math.max(start, dayStartMs);
  const clampedEnd = Math.min(end, dayEndMs);
  const left = ((clampedStart - dayStartMs) / DAY_MS) * 100;
  const width = Math.max(0.7, ((clampedEnd - clampedStart) / DAY_MS) * 100);
  return { left, width };
}

function overlapMinutes(session: ActivitySession, rangeStartMs: number, rangeEndMs: number): number {
  const start = new Date(session.startTs).getTime();
  const end = new Date(session.endTs).getTime();
  const overlapStart = Math.max(start, rangeStartMs);
  const overlapEnd = Math.min(end, rangeEndMs);
  return Math.max(0, Math.round((overlapEnd - overlapStart) / 60000));
}

function getDomain(pageUrl: string): string {
  if (!pageUrl) return "";
  try {
    return new URL(pageUrl).hostname;
  } catch {
    return "";
  }
}

function getFaviconUrl(domain: string): string | null {
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

function shortenLabel(value: string, maxLength = 18): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function shortenMiddle(value: string, headLength = 8, tailLength = 4): string {
  if (value.length <= headLength + tailLength + 3) return value;
  return `${value.slice(0, headLength)}...${value.slice(-tailLength)}`;
}

function formatDeviceLabel(deviceType: ActivitySession["deviceType"], deviceId: string): string {
  const prefix = `${deviceType}-`;
  const trimmedId = deviceId.toLowerCase().startsWith(prefix) ? deviceId.slice(prefix.length) : deviceId;
  return `${deviceType} · ${shortenMiddle(trimmedId, 8, 4)}`;
}

function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function getFallbackIcon(label: string, kind: "app" | "site"): string {
  const text = label.toLowerCase();
  if (kind === "site") return "🌐";
  if (text.includes("code") || text.includes("studio")) return "💻";
  if (text.includes("terminal") || text.includes("powershell") || text.includes("cmd")) return "⌨️";
  if (text.includes("slack") || text.includes("teams") || text.includes("zoom") || text.includes("discord")) return "💬";
  if (text.includes("youtube") || text.includes("netflix") || text.includes("twitch")) return "🎬";
  if (text.includes("spotify") || text.includes("music")) return "🎵";
  if (text.includes("valorant") || text.includes("steam") || text.includes("epic") || text.includes("game")) return "🎮";
  return "🧩";
}

function getSessionIcon(session: ActivitySession): UsageIcon {
  const domain = getDomain(session.pageUrl);
  if (domain) {
    const favicon = getFaviconUrl(domain);
    if (favicon) {
      return { kind: "favicon", value: favicon };
    }
  }
  return { kind: "emoji", value: getFallbackIcon(session.appName || session.pageUrl, "app") };
}

function buildUsageEntry(name: string, minutes: number, kind: "app" | "site"): UsageEntry {
  const label = shortenLabel(name, 18);
  const icon: UsageIcon =
    kind === "site"
      ? { kind: "favicon", value: getFaviconUrl(name) ?? "" }
      : { kind: "emoji", value: getFallbackIcon(name, "app") };
  const normalizedIcon: UsageIcon =
    icon.kind === "favicon" && !icon.value ? { kind: "emoji", value: getFallbackIcon(name, kind) } : icon;
  return {
    id: `${kind}:${name}`,
    name,
    label,
    minutes,
    icon: normalizedIcon,
    kind
  };
}

function UsageTick({
  x = 0,
  y = 0,
  payload,
  entries
}: {
  x?: number;
  y?: number;
  payload?: { value: string };
  entries: UsageEntry[];
}) {
  const entry = entries.find((item) => item.label === payload?.value);
  if (!entry) return null;
  const iconSize = 14;
  const iconY = y - 18;
  const textY = y + 10;
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{entry.name}</title>
      {entry.icon.kind === "favicon" ? (
        <image href={entry.icon.value} x={-iconSize / 2} y={iconY} width={iconSize} height={iconSize} />
      ) : (
        <text x={0} y={iconY + iconSize} textAnchor="middle" fontSize="12">
          {entry.icon.value}
        </text>
      )}
      <text x={0} y={textY} textAnchor="middle" fontSize="10" fill="#475569">
        {entry.label}
      </text>
    </g>
  );
}

export default function App() {
  const [serverUrl, setServerUrl] = useState("http://localhost:8787");
  const [userId, setUserId] = useState("demo-user");
  const [deviceId] = useState("dashboard-viewer");
  const [encryptionKey, setEncryptionKey] = useState("change-this-encryption-key");
  const [sessions, setSessions] = useState<ActivitySession[]>([]);
  const [status, setStatus] = useState("Ready");
  const [syncState, setSyncState] = useState("unknown");
  const [brokenIcons, setBrokenIcons] = useState<Record<string, boolean>>({});

  const topUsage = useMemo(() => {
    const map = new Map<string, { minutes: number; kind: "app" | "site"; name: string }>();
    for (const session of sessions) {
      if (session.pageUrl) {
        const domain = getDomain(session.pageUrl) || session.pageUrl;
        const id = `site:${domain}`;
        const current = map.get(id) ?? { minutes: 0, kind: "site", name: domain };
        map.set(id, {
          ...current,
          minutes: current.minutes + minutesBetween(session.startTs, session.endTs)
        });
      } else {
        const appName = session.appName || "Unknown app";
        const id = `app:${appName}`;
        const current = map.get(id) ?? { minutes: 0, kind: "app", name: appName };
        map.set(id, {
          ...current,
          minutes: current.minutes + minutesBetween(session.startTs, session.endTs)
        });
      }
    }
    return [...map.values()]
      .map((entry) => buildUsageEntry(entry.name, entry.minutes, entry.kind))
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

  const timelineDayStartMs = useMemo(() => {
    if (!sessions.length) return toDayStartMs(new Date());
    const latestStart = sessions.reduce((max, session) => {
      const start = new Date(session.startTs).getTime();
      return start > max ? start : max;
    }, 0);
    return toDayStartMs(new Date(latestStart));
  }, [sessions]);

  const timelineDateLabel = useMemo(() => {
    const date = new Date(timelineDayStartMs);
    return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }, [timelineDayStartMs]);

  const timelineRows = useMemo(() => {
    const map = new Map<string, ActivitySession[]>();
    for (const session of sessions) {
      if (!sessionOverlapsDay(session, timelineDayStartMs)) continue;
      const key = `${session.deviceType}:${session.deviceId}`;
      const list = map.get(key) ?? [];
      list.push(session);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [sessions, timelineDayStartMs]);

  const deviceUsage = useMemo(() => {
    const dayStartMs = timelineDayStartMs;
    const dayEndMs = dayStartMs + DAY_MS;
    const weekStartMs = dayStartMs - 6 * DAY_MS;
    const weekEndMs = dayEndMs;
    const map = new Map<
      string,
      { deviceType: ActivitySession["deviceType"]; deviceId: string; dailyMinutes: number; weeklyMinutes: number }
    >();
    for (const session of sessions) {
      const key = `${session.deviceType}:${session.deviceId}`;
      const current =
        map.get(key) ?? { deviceType: session.deviceType, deviceId: session.deviceId, dailyMinutes: 0, weeklyMinutes: 0 };
      const dailyMinutes = overlapMinutes(session, dayStartMs, dayEndMs);
      const weeklyMinutes = overlapMinutes(session, weekStartMs, weekEndMs);
      map.set(key, {
        ...current,
        dailyMinutes: current.dailyMinutes + dailyMinutes,
        weeklyMinutes: current.weeklyMinutes + weeklyMinutes
      });
    }
    return [...map.values()]
      .map((entry) => ({
        device: formatDeviceLabel(entry.deviceType, entry.deviceId),
        deviceId: entry.deviceId,
        deviceType: entry.deviceType,
        dailyMinutes: entry.dailyMinutes,
        weeklyMinutes: entry.weeklyMinutes
      }))
      .sort((a, b) => b.weeklyMinutes - a.weeklyMinutes);
  }, [sessions, timelineDayStartMs]);
  const hasDeviceUsage = deviceUsage.some((entry) => entry.dailyMinutes > 0 || entry.weeklyMinutes > 0);

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
          <p className="stat-with-icon" title={topUsage[0]?.name ?? ""}>
            <span className="stat-icon" aria-hidden="true">
              {topUsage[0]?.icon.kind === "favicon" ? (
                <img src={topUsage[0]?.icon.value} alt="" />
              ) : (
                <span>{topUsage[0]?.icon.value ?? "🧩"}</span>
              )}
            </span>
            <span>{topUsage[0]?.label ?? "-"}</span>
          </p>
        </article>
        <article>
          <h2>Phone pickups</h2>
          <p>{sessions.filter((s) => s.deviceType === "mobile" && s.appName === "Unlock Event").length}</p>
        </article>
      </section>

      <section className="device-usage">
        <h2>Screen time by device</h2>
        {hasDeviceUsage ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={deviceUsage}>
              <CartesianGrid strokeDasharray="4 4" />
              <XAxis dataKey="device" interval={0} tickLine={false} axisLine={false} height={54} />
              <YAxis />
              <Tooltip
                formatter={(value, name) => [formatMinutes(Number(value)), name]}
                labelFormatter={(label) => {
                  const entry = deviceUsage.find((item) => item.device === label);
                  return entry ? `${entry.deviceType} · ${entry.deviceId}` : label;
                }}
              />
              <Legend />
              <Bar dataKey="dailyMinutes" name="Daily" fill="#2563eb" radius={[6, 6, 0, 0]} />
              <Bar dataKey="weeklyMinutes" name="Weekly" fill="#7c3aed" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="empty-state">No device usage yet. Click Refresh data to load recent activity.</p>
        )}
      </section>

      <section className="timeline">
      <h2>Unified day timeline · {timelineDateLabel}</h2>
      {timelineRows.map(([key, value]) => (
        <div key={key} className="timeline-row">
          <div className="label">{formatDeviceLabel(value[0]?.deviceType ?? "desktop", value[0]?.deviceId ?? key)}</div>
          <div className="segments">
            {value.map((session) => {
              const { left, width } = clampSessionToDay(session, timelineDayStartMs);
              const icon = getSessionIcon(session);
              const canShowFavicon = icon.kind === "favicon" && !brokenIcons[session.id];
              return (
                <span
                  key={session.id}
                  className={`segment ${session.category}`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`${session.appName || session.pageUrl} (${new Date(session.startTs).toLocaleTimeString()}-${new Date(
                    session.endTs
                  ).toLocaleTimeString()})`}
                >
                  {width > 1.6 ? (
                    <span className="segment-icon" aria-hidden="true">
                      {canShowFavicon ? (
                        <img
                          src={icon.value}
                          alt=""
                          onError={() =>
                            setBrokenIcons((prev) => ({
                              ...prev,
                              [session.id]: true
                            }))
                          }
                        />
                      ) : (
                        <span>{icon.kind === "emoji" ? icon.value : "🧩"}</span>
                      )}
                    </span>
                  ) : null}
                </span>
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
              <XAxis
                dataKey="label"
                height={48}
                interval={0}
                tickLine={false}
                axisLine={false}
                tick={(props) => <UsageTick {...props} entries={topUsage} />}
              />
              <YAxis />
              <Tooltip
                labelFormatter={(value) => topUsage.find((entry) => entry.label === value)?.name ?? value}
              />
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
