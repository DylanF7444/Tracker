import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { TimelineRowTrack } from "./components/TimelineRowTrack";
import type { DashboardSnapshot, EditableSettings } from "./types";

const emptySnapshot: DashboardSnapshot = {
  stats: {
    totalScreenMinutes: 0,
    deepFocusMinutes: 0,
    topApp: "-",
    phonePickups: 0,
    focusScore: 0
  },
  timelineRows: [],
  topUsage: [],
  weeklyTrend: [],
  goalAlerts: []
};

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours === 0) return `${rem}m`;
  return `${hours}h ${rem}m`;
}

function formatRelativeMinutes(minutes: number): string {
  if (minutes <= 0) return "<1m ago";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (rem === 0) return `${hours}h ago`;
  return `${hours}h ${rem}m ago`;
}

export default function App() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(emptySnapshot);
  const [syncStatus, setSyncStatus] = useState("Syncing...");
  const [tracking, setTracking] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "settings">("overview");
  const [settings, setSettings] = useState<EditableSettings | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  async function refreshDashboard() {
    const [snapshotData, status, trackingActive] = await Promise.all([
      invoke<DashboardSnapshot>("get_dashboard_snapshot"),
      invoke<string>("get_sync_status"),
      invoke<boolean>("is_tracking_active")
    ]);
    setSnapshot(snapshotData);
    setSyncStatus(status);
    setTracking(trackingActive);
  }

  async function refreshSettings() {
    const loaded = await invoke<EditableSettings>("get_settings");
    setSettings(loaded);
  }

  useEffect(() => {
    void refreshDashboard();
    void refreshSettings();

    const interval = window.setInterval(() => {
      void refreshDashboard();
    }, 15_000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const topUsageChartData = useMemo(
    () =>
      snapshot.topUsage.map((item) => ({
        name: item.key,
        minutes: item.minutes
      })),
    [snapshot.topUsage]
  );

  const latestDetectedByDevice = useMemo(
    () =>
      snapshot.timelineRows
        .map((row) => {
          if (row.segments.length === 0) {
            return null;
          }

          const latest = row.segments.reduce((latestSegment, segment) =>
            new Date(segment.endTs).getTime() >= new Date(latestSegment.endTs).getTime() ? segment : latestSegment
          );
          const lastSeenMinutes = Math.max(0, Math.round((Date.now() - new Date(latest.endTs).getTime()) / 60_000));
          const freshness = lastSeenMinutes <= 1 ? "active" : lastSeenMinutes <= 5 ? "recent" : "stale";

          return {
            id: `${row.deviceType}-${row.deviceId}`,
            deviceType: row.deviceType,
            deviceId: row.deviceId,
            label: latest.label,
            lastSeenMinutes,
            freshness
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .sort((a, b) => a.deviceType.localeCompare(b.deviceType) || a.deviceId.localeCompare(b.deviceId)),
    [snapshot.timelineRows]
  );

  async function saveSettings() {
    if (!settings) return;
    await invoke("save_settings", { settings });
    setStatusMessage("Settings saved.");
    window.setTimeout(() => setStatusMessage(""), 2000);
  }

  async function handleStartTracking() {
    await invoke("start_tracking");
    setTracking(true);
  }

  async function handleStopTracking() {
    await invoke("stop_tracking");
    setTracking(false);
  }

  async function handleSyncNow() {
    setSyncStatus("Syncing...");
    await invoke("sync_now");
    await refreshDashboard();
  }

  async function toggleFocusMode() {
    const next = !focusMode;
    await invoke("set_focus_mode", { enabled: next });
    setFocusMode(next);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">Focus</div>
        <div className="status">{syncStatus}</div>
        <div className="toolbar">
          {tracking ? (
            <button type="button" onClick={handleStopTracking}>
              Stop tracking
            </button>
          ) : (
            <button type="button" onClick={handleStartTracking}>
              Start tracking
            </button>
          )}
          <button type="button" onClick={toggleFocusMode}>
            {focusMode ? "Disable focus mode" : "Enable focus mode"}
          </button>
          <button type="button" onClick={handleSyncNow}>
            Sync now
          </button>
        </div>
      </header>

      <nav className="sidebar">
        <button type="button" className={activeTab === "overview" ? "active" : ""} onClick={() => setActiveTab("overview")}>
          Overview
        </button>
        <button type="button" className={activeTab === "settings" ? "active" : ""} onClick={() => setActiveTab("settings")}>
          Settings
        </button>
      </nav>

      <main className="content">
        {activeTab === "overview" ? (
          <>
            <section className="stats-grid">
              <article>
                <h3>Screen time</h3>
                <p>{formatMinutes(snapshot.stats.totalScreenMinutes)}</p>
              </article>
              <article>
                <h3>Deep focus</h3>
                <p>{formatMinutes(snapshot.stats.deepFocusMinutes)}</p>
              </article>
              <article>
                <h3>Top app</h3>
                <p>{snapshot.stats.topApp}</p>
              </article>
              <article>
                <h3>Phone pickups</h3>
                <p>{snapshot.stats.phonePickups}</p>
              </article>
              <article>
                <h3>Focus score</h3>
                <p>{snapshot.stats.focusScore}%</p>
              </article>
            </section>

            <section className="card">
              <div className="card-title-row">
                <h2>Current app by device</h2>
                {settings ? <span className="idle-pill">Idle detection on ({settings.idleThresholdSeconds}s)</span> : null}
              </div>
              {latestDetectedByDevice.length > 0 ? (
                <div className="detected-device-grid">
                  {latestDetectedByDevice.map((device) => (
                    <article key={device.id} className="detected-device-card">
                      <div className="detected-device-header">
                        <strong>
                          {device.deviceType} · {device.deviceId}
                        </strong>
                        <span className={`freshness-pill ${device.freshness}`}>
                          {device.freshness === "active" ? "Active now" : device.freshness === "recent" ? "Recent" : "Stale"}
                        </span>
                      </div>
                      <p className="detected-device-app">{device.label || "Unknown app"}</p>
                      <p className="detected-device-meta">Last seen {formatRelativeMinutes(device.lastSeenMinutes)}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="detected-device-empty">No tracked sessions yet for this day.</p>
              )}
            </section>

            {snapshot.goalAlerts.length > 0 ? (
              <section className="goal-alerts">
                {snapshot.goalAlerts.map((alert) => (
                  <div key={alert} className="goal-alert">
                    {alert}
                  </div>
                ))}
              </section>
            ) : null}

            <section className="card">
              <h2>Day timeline</h2>
              {snapshot.timelineRows.map((row) => (
                <TimelineRowTrack key={`${row.deviceType}-${row.deviceId}`} row={row} />
              ))}
            </section>

            <section className="chart-row">
              <article className="card">
                <h2>Top apps & sites</h2>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={topUsageChartData}>
                    <CartesianGrid strokeDasharray="4 4" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="minutes" fill="#4f46e5" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </article>
              <article className="card">
                <h2>Weekly trends</h2>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={snapshot.weeklyTrend}>
                    <CartesianGrid strokeDasharray="4 4" />
                    <XAxis dataKey="day" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="focusScore" stroke="#16a34a" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </article>
            </section>
          </>
        ) : (
          <section className="card">
            <h2>Settings & customization</h2>
            {settings ? (
              <div className="settings-form">
                <label>
                  Sync server URL
                  <input
                    value={settings.syncServerUrl}
                    onChange={(event) => setSettings({ ...settings, syncServerUrl: event.target.value })}
                  />
                </label>
                <label>
                  User ID
                  <input value={settings.userId} onChange={(event) => setSettings({ ...settings, userId: event.target.value })} />
                </label>
                <label>
                  Device ID
                  <input
                    value={settings.deviceId}
                    onChange={(event) => setSettings({ ...settings, deviceId: event.target.value })}
                  />
                </label>
                <label>
                  Encryption key
                  <input
                    value={settings.encryptionKey}
                    onChange={(event) => setSettings({ ...settings, encryptionKey: event.target.value })}
                  />
                </label>
                <label>
                  Idle threshold (seconds)
                  <input
                    type="number"
                    min={15}
                    value={settings.idleThresholdSeconds}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        idleThresholdSeconds: Number(event.target.value)
                      })
                    }
                  />
                </label>
                <label>
                  Excluded apps (comma-separated)
                  <input
                    value={settings.excludedApps.join(", ")}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        excludedApps: event.target.value
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean)
                      })
                    }
                  />
                </label>
                <label>
                  Blocked domains in focus mode (comma-separated)
                  <input
                    value={settings.blockedDomains.join(", ")}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        blockedDomains: event.target.value
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean)
                      })
                    }
                  />
                </label>
                <button type="button" onClick={saveSettings}>
                  Save settings
                </button>
                {statusMessage ? <p className="settings-status">{statusMessage}</p> : null}
              </div>
            ) : null}
          </section>
        )}
      </main>
    </div>
  );
}
