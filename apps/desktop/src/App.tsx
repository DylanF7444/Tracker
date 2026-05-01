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
import type { DashboardSnapshot, EditableSettings, TimelineRow, TimelineSegment } from "./types";

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

const SOURCE_LABELS: Record<string, string> = {
  "desktop-window": "Desktop",
  "browser-tab": "Browser",
  "mobile-usage": "Mobile",
  "manual-tag": "Manual"
};

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours === 0) return `${rem}m`;
  return `${hours}h ${rem}m`;
}

function formatZoomLabel(zoom: number): string {
  const rounded = Math.round(zoom * 10) / 10;
  return `${rounded}x`;
}

function minutesBetween(startTs: string, endTs: string): number {
  return Math.max(0, Math.round((new Date(endTs).getTime() - new Date(startTs).getTime()) / 60000));
}

function formatRelativeMinutes(minutes: number): string {
  if (minutes <= 0) return "<1m ago";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (rem === 0) return `${hours}h ago`;
  return `${hours}h ${rem}m ago`;
}

function safeDomain(url: string): string {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function segmentIcon(segment: TimelineSegment): string {
  const text = segment.label.toLowerCase();
  if (segment.source === "mobile-usage") return "📱";
  if (segment.source === "browser-tab") return "🌐";
  if (text.includes("code") || text.includes("studio")) return "💻";
  if (text.includes("terminal") || text.includes("powershell") || text.includes("cmd")) return "⌨️";
  if (text.includes("slack") || text.includes("teams") || text.includes("zoom")) return "💬";
  if (text.includes("youtube") || text.includes("netflix")) return "🎬";
  if (text.includes("spotify")) return "🎵";
  return "🧩";
}

type SelectedSegment = {
  row: TimelineRow;
  segment: TimelineSegment;
};

export default function App() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(emptySnapshot);
  const [syncStatus, setSyncStatus] = useState("Syncing...");
  const [tracking, setTracking] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "settings">("overview");
  const [settings, setSettings] = useState<EditableSettings | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [selectedDeviceKey, setSelectedDeviceKey] = useState("all");
  const [selectedSegment, setSelectedSegment] = useState<SelectedSegment | null>(null);
  const [timelineZoom, setTimelineZoom] = useState(1.8);
  const [timelineExpanded, setTimelineExpanded] = useState(false);

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
    }, 5_000);

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

  const availableDevices = useMemo(
    () =>
      snapshot.timelineRows
        .map((row) => ({
          key: `${row.deviceType}:${row.deviceId}`,
          deviceType: row.deviceType,
          deviceId: row.deviceId
        }))
        .sort((a, b) => a.deviceType.localeCompare(b.deviceType) || a.deviceId.localeCompare(b.deviceId)),
    [snapshot.timelineRows]
  );

  useEffect(() => {
    if (selectedDeviceKey === "all") {
      return;
    }
    const exists = availableDevices.some((device) => device.key === selectedDeviceKey);
    if (!exists) {
      setSelectedDeviceKey("all");
    }
  }, [availableDevices, selectedDeviceKey]);

  useEffect(() => {
    if (!selectedSegment) {
      return;
    }

    const row = snapshot.timelineRows.find(
      (item) => item.deviceType === selectedSegment.row.deviceType && item.deviceId === selectedSegment.row.deviceId
    );
    if (!row) {
      setSelectedSegment(null);
      return;
    }

    const segment = row.segments.find((item) => item.id === selectedSegment.segment.id);
    if (!segment) {
      setSelectedSegment(null);
      return;
    }

    if (segment.endTs !== selectedSegment.segment.endTs || segment.startTs !== selectedSegment.segment.startTs) {
      setSelectedSegment({ row, segment });
    }
  }, [selectedSegment, snapshot.timelineRows]);

  const timelineRowsFiltered = useMemo(() => {
    if (selectedDeviceKey === "all") {
      return snapshot.timelineRows;
    }
    return snapshot.timelineRows.filter((row) => `${row.deviceType}:${row.deviceId}` === selectedDeviceKey);
  }, [selectedDeviceKey, snapshot.timelineRows]);

  const navigableSessions = useMemo(
    () =>
      timelineRowsFiltered
        .flatMap((row) =>
          row.segments.map((segment) => ({
            row,
            segment,
            startMs: new Date(segment.startTs).getTime(),
            endMs: new Date(segment.endTs).getTime()
          }))
        )
        .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.segment.id.localeCompare(b.segment.id)),
    [timelineRowsFiltered]
  );

  const selectedSessionIndex = useMemo(() => {
    if (!selectedSegment) {
      return -1;
    }
    return navigableSessions.findIndex((item) => item.segment.id === selectedSegment.segment.id);
  }, [navigableSessions, selectedSegment]);

  useEffect(() => {
    if (!selectedSegment) {
      return;
    }
    const isVisible = navigableSessions.some((item) => item.segment.id === selectedSegment.segment.id);
    if (!isVisible) {
      setSelectedSegment(null);
    }
  }, [navigableSessions, selectedSegment]);

  const deviceUsageCards = useMemo(
    () =>
      snapshot.timelineRows
        .map((row) => {
          const sourceTotals = new Map<string, number>();
          const categoryTotals = new Map<string, number>();
          let totalMinutes = 0;
          for (const segment of row.segments) {
            const mins = minutesBetween(segment.startTs, segment.endTs);
            totalMinutes += mins;
            sourceTotals.set(segment.source, (sourceTotals.get(segment.source) ?? 0) + mins);
            categoryTotals.set(segment.category, (categoryTotals.get(segment.category) ?? 0) + mins);
          }
          return {
            key: `${row.deviceType}:${row.deviceId}`,
            deviceType: row.deviceType,
            deviceId: row.deviceId,
            totalMinutes,
            sourceTotals: [...sourceTotals.entries()].sort((a, b) => b[1] - a[1]),
            categoryTotals: [...categoryTotals.entries()].sort((a, b) => b[1] - a[1])
          };
        })
        .sort((a, b) => b.totalMinutes - a.totalMinutes),
    [snapshot.timelineRows]
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
            source: latest.source,
            segment: latest,
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

  function adjustTimelineZoom(next: number) {
    setTimelineZoom(Math.max(1, Math.min(8, Math.round(next * 10) / 10)));
  }

  function selectSessionAt(index: number) {
    if (index < 0 || index >= navigableSessions.length) {
      return;
    }
    const target = navigableSessions[index];
    setSelectedSegment({ row: target.row, segment: target.segment });
  }

  function handlePrevSession() {
    if (navigableSessions.length === 0) {
      return;
    }
    if (selectedSessionIndex < 0) {
      selectSessionAt(navigableSessions.length - 1);
      return;
    }
    selectSessionAt(Math.max(0, selectedSessionIndex - 1));
  }

  function handleNextSession() {
    if (navigableSessions.length === 0) {
      return;
    }
    if (selectedSessionIndex < 0) {
      selectSessionAt(0);
      return;
    }
    selectSessionAt(Math.min(navigableSessions.length - 1, selectedSessionIndex + 1));
  }

  useEffect(() => {
    if (activeTab !== "overview") {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
      if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        handlePrevSession();
      }
      if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        handleNextSession();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTab, navigableSessions, selectedSessionIndex]);

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
                      <p className="detected-device-app">
                        <span className="device-app-icon" aria-hidden="true">
                          {segmentIcon(device.segment)}
                        </span>
                        <span>{safeDomain(device.segment.pageUrl) || device.label || "Unknown app"}</span>
                      </p>
                      <p className="detected-device-meta">{SOURCE_LABELS[device.source] ?? device.source}</p>
                      <p className="detected-device-meta">Last seen {formatRelativeMinutes(device.lastSeenMinutes)}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="detected-device-empty">No tracked sessions yet for this day.</p>
              )}
            </section>

            <section className="card">
              <div className="card-title-row">
                <h2>Usage split by device</h2>
              </div>
              {deviceUsageCards.length > 0 ? (
                <div className="device-usage-grid">
                  {deviceUsageCards.map((device) => (
                    <article key={device.key} className="device-usage-card">
                      <h3>
                        {device.deviceType} · {device.deviceId}
                      </h3>
                      <p className="device-usage-total">Total: {formatMinutes(device.totalMinutes)}</p>
                      <div className="device-usage-lines">
                        {device.sourceTotals.map(([source, minutes]) => (
                          <span key={source} className="device-usage-pill">
                            {SOURCE_LABELS[source] ?? source}: {formatMinutes(minutes)}
                          </span>
                        ))}
                      </div>
                      {device.categoryTotals.length > 0 ? (
                        <p className="device-usage-meta">
                          Top category: {device.categoryTotals[0][0]} ({formatMinutes(device.categoryTotals[0][1])})
                        </p>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="detected-device-empty">No device usage captured yet.</p>
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

            <section className={`card timeline-card ${timelineExpanded ? "expanded" : ""}`}>
              <div className="card-title-row">
                <h2>Interactive day timeline</h2>
              </div>
              <div className="timeline-toolbar">
                <div className="timeline-device-filters">
                  <button
                    type="button"
                    className={selectedDeviceKey === "all" ? "active" : ""}
                    onClick={() => setSelectedDeviceKey("all")}
                  >
                    All devices
                  </button>
                  {availableDevices.map((device) => (
                    <button
                      key={device.key}
                      type="button"
                      className={selectedDeviceKey === device.key ? "active" : ""}
                      onClick={() => setSelectedDeviceKey(device.key)}
                    >
                      {device.deviceType}
                    </button>
                  ))}
                </div>
                <div className="timeline-nav-controls">
                  <button
                    type="button"
                    onClick={handlePrevSession}
                    disabled={navigableSessions.length === 0 || selectedSessionIndex === 0}
                  >
                    Prev session
                  </button>
                  <span className="timeline-nav-status">
                    {navigableSessions.length === 0
                      ? "No sessions"
                      : selectedSessionIndex >= 0
                        ? `${selectedSessionIndex + 1}/${navigableSessions.length}`
                        : `0/${navigableSessions.length}`}
                  </span>
                  <button
                    type="button"
                    onClick={handleNextSession}
                    disabled={
                      navigableSessions.length === 0 || selectedSessionIndex === navigableSessions.length - 1
                    }
                  >
                    Next session
                  </button>
                </div>
                <div className="timeline-zoom-controls">
                  <button type="button" onClick={() => adjustTimelineZoom(timelineZoom - 0.2)}>
                    -
                  </button>
                  <input
                    type="range"
                    min={1}
                    max={8}
                    step={0.2}
                    value={timelineZoom}
                    onChange={(event) => adjustTimelineZoom(Number(event.target.value))}
                    aria-label="Timeline zoom level"
                  />
                  <button type="button" onClick={() => adjustTimelineZoom(timelineZoom + 0.2)}>
                    +
                  </button>
                  <span className="timeline-zoom-value">{formatZoomLabel(timelineZoom)}</span>
                  <button
                    type="button"
                    className={timelineExpanded ? "active" : ""}
                    onClick={() => setTimelineExpanded((current) => !current)}
                  >
                    {timelineExpanded ? "Compact view" : "Expanded view"}
                  </button>
                </div>
              </div>
              {timelineRowsFiltered.map((row) => (
                <TimelineRowTrack
                  key={`${row.deviceType}-${row.deviceId}`}
                  row={row}
                  selectedSegmentId={selectedSegment?.segment.id}
                  zoomLevel={timelineZoom}
                  expanded={timelineExpanded}
                  onSelectSegment={(segment, selectedRow) => setSelectedSegment({ row: selectedRow, segment })}
                />
              ))}
              {timelineRowsFiltered.length === 0 ? (
                <p className="detected-device-empty">No timeline rows match this device filter.</p>
              ) : null}
              {selectedSegment ? (
                <div className="selected-segment-card">
                  <h3>Selected session</h3>
                  <p className="selected-segment-title">
                    <span aria-hidden="true">{segmentIcon(selectedSegment.segment)}</span>
                    <span>{safeDomain(selectedSegment.segment.pageUrl) || selectedSegment.segment.label || "Unknown app/site"}</span>
                  </p>
                  <p className="selected-segment-meta">
                    {selectedSegment.row.deviceType} · {selectedSegment.row.deviceId} ·{" "}
                    {SOURCE_LABELS[selectedSegment.segment.source] ?? selectedSegment.segment.source}
                  </p>
                  <p className="selected-segment-meta">
                    {new Date(selectedSegment.segment.startTs).toLocaleTimeString()} -{" "}
                    {new Date(selectedSegment.segment.endTs).toLocaleTimeString()} (
                    {formatMinutes(minutesBetween(selectedSegment.segment.startTs, selectedSegment.segment.endTs))})
                  </p>
                  {selectedSegment.segment.pageUrl ? (
                    <p className="selected-segment-meta selected-segment-url">{selectedSegment.segment.pageUrl}</p>
                  ) : null}
                </div>
              ) : null}
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
