export type DeviceType = "desktop" | "mobile" | "browser";
export type TrackingSource = "desktop-window" | "browser-tab" | "mobile-usage" | "manual-tag";

export type ActivityCategory =
  | "productivity"
  | "communication"
  | "entertainment"
  | "neutral"
  | "distracting"
  | "meeting"
  | "break"
  | "system";

export type ProductivityClass = "productive" | "neutral" | "distracting";

export interface CategoryRule {
  id: string;
  pattern: string;
  category: ActivityCategory;
  productivity: ProductivityClass;
  appliesTo: "app" | "domain" | "title";
}

export interface GoalRule {
  id: string;
  targetType: "app" | "category";
  target: string;
  minutesLimit: number;
}

export interface ScheduleRule {
  id: string;
  name: string;
  weekdays: number[];
  startHour: number;
  endHour: number;
  trackingMode: "work" | "personal";
}

export interface FocusSettings {
  userId: string;
  deviceId: string;
  syncServerUrl: string;
  encryptionKey: string;
  idleThresholdSeconds: number;
  excludedApps: string[];
  blockedApps: string[];
  blockedDomains: string[];
  categoryRules: CategoryRule[];
  goals: GoalRule[];
  schedules: ScheduleRule[];
}

export interface ActivitySession {
  id: string;
  userId: string;
  deviceId: string;
  deviceType: DeviceType;
  source: TrackingSource;
  appName: string;
  windowTitle: string;
  pageUrl: string;
  category: ActivityCategory;
  productivity: ProductivityClass;
  tag: string;
  startTs: string;
  endTs: string;
  createdAt: string;
}

export interface EncryptedEnvelope {
  version: 1;
  alg: "aes-256-gcm";
  nonce: string;
  ciphertext: string;
}

export interface SyncEvent {
  eventId: string;
  sourceDeviceId: string;
  sourceDeviceType: DeviceType;
  startTs: string;
  endTs: string;
  envelope: EncryptedEnvelope;
}

export interface SyncPushRequest {
  userId: string;
  deviceId: string;
  deviceType: DeviceType;
  events: SyncEvent[];
}

export interface SyncPushResponse {
  accepted: number;
  cursor: number;
}

export interface SyncPullResponse {
  events: Array<SyncEvent & { cursor: number }>;
  cursor: number;
}

export interface DeviceSyncStatus {
  userId: string;
  deviceId: string;
  deviceType: DeviceType;
  online: boolean;
  lastSeenAt: string;
  lastSyncAt: string;
}

export interface TimelineSegment {
  id: string;
  label: string;
  startTs: string;
  endTs: string;
  category: ActivityCategory;
  source: TrackingSource;
  pageUrl: string;
  tag: string;
}

export interface TimelineRow {
  deviceType: DeviceType;
  deviceId: string;
  segments: TimelineSegment[];
}

export interface TopUsageItem {
  key: string;
  category: ActivityCategory;
  minutes: number;
}

export interface WeeklyTrendPoint {
  day: string;
  totalsByCategory: Record<ActivityCategory, number>;
  focusScore: number;
}

export interface DashboardStats {
  totalScreenMinutes: number;
  deepFocusMinutes: number;
  topApp: string;
  phonePickups: number;
  focusScore: number;
}

export interface DashboardSnapshot {
  stats: DashboardStats;
  timelineRows: TimelineRow[];
  topUsage: TopUsageItem[];
  weeklyTrend: WeeklyTrendPoint[];
}

export const DEFAULT_CATEGORY_RULES: CategoryRule[] = [
  { id: "r-vscode", pattern: "code", category: "productivity", productivity: "productive", appliesTo: "app" },
  { id: "r-terminal", pattern: "terminal", category: "productivity", productivity: "productive", appliesTo: "app" },
  { id: "r-slack", pattern: "slack", category: "communication", productivity: "neutral", appliesTo: "app" },
  { id: "r-teams", pattern: "teams", category: "communication", productivity: "neutral", appliesTo: "app" },
  { id: "r-youtube", pattern: "youtube.com", category: "entertainment", productivity: "distracting", appliesTo: "domain" },
  { id: "r-netflix", pattern: "netflix.com", category: "entertainment", productivity: "distracting", appliesTo: "domain" }
];

export function normalizeString(value: string): string {
  return value.trim().toLowerCase();
}

export function classifyActivity(
  appName: string,
  pageUrl: string,
  title: string,
  rules: CategoryRule[]
): { category: ActivityCategory; productivity: ProductivityClass } {
  const app = normalizeString(appName);
  const url = normalizeString(pageUrl);
  const ttl = normalizeString(title);

  for (const rule of rules) {
    const pattern = normalizeString(rule.pattern);
    const haystack = rule.appliesTo === "app" ? app : rule.appliesTo === "domain" ? url : ttl;
    if (pattern.length > 0 && haystack.includes(pattern)) {
      return { category: rule.category, productivity: rule.productivity };
    }
  }

  return { category: "neutral", productivity: "neutral" };
}

export function minutesBetween(startTs: string, endTs: string): number {
  const start = new Date(startTs).getTime();
  const end = new Date(endTs).getTime();
  return Math.max(0, Math.round((end - start) / 60000));
}

export function calculateFocusScore(sessions: ActivitySession[]): number {
  let productive = 0;
  let distracting = 0;

  for (const session of sessions) {
    const minutes = minutesBetween(session.startTs, session.endTs);
    if (session.productivity === "productive") productive += minutes;
    if (session.productivity === "distracting") distracting += minutes;
  }

  const total = productive + distracting;
  if (total === 0) return 50;
  return Math.max(0, Math.min(100, Math.round((productive / total) * 100)));
}

export function dayKey(input: Date | string): string {
  const date = typeof input === "string" ? new Date(input) : input;
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}
