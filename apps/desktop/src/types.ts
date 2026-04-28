type ActivityCategory =
  | "productivity"
  | "communication"
  | "entertainment"
  | "neutral"
  | "distracting"
  | "meeting"
  | "break"
  | "system";

export interface StatBlock {
  totalScreenMinutes: number;
  deepFocusMinutes: number;
  topApp: string;
  phonePickups: number;
  focusScore: number;
}

export interface TimelineSegment {
  id: string;
  label: string;
  category: ActivityCategory;
  startTs: string;
  endTs: string;
  pageUrl: string;
  tag: string;
}

export interface TimelineRow {
  deviceType: "desktop" | "mobile" | "browser";
  deviceId: string;
  segments: TimelineSegment[];
}

export interface TopUsageItem {
  key: string;
  category: ActivityCategory;
  minutes: number;
}

export interface WeeklyTrendItem {
  day: string;
  focusScore: number;
  productivity: number;
  communication: number;
  entertainment: number;
  neutral: number;
  distracting: number;
  meeting: number;
  break: number;
  system: number;
}

export interface DashboardSnapshot {
  stats: StatBlock;
  timelineRows: TimelineRow[];
  topUsage: TopUsageItem[];
  weeklyTrend: WeeklyTrendItem[];
  goalAlerts: string[];
}

export interface EditableSettings {
  userId: string;
  deviceId: string;
  syncServerUrl: string;
  encryptionKey: string;
  idleThresholdSeconds: number;
  excludedApps: string[];
  blockedApps: string[];
  blockedDomains: string[];
  categoryRules: Array<{
    id: string;
    pattern: string;
    category: string;
    productivity: string;
    appliesTo: string;
  }>;
  goals: Array<{
    id: string;
    targetType: string;
    target: string;
    minutesLimit: number;
  }>;
  schedules: Array<{
    id: string;
    name: string;
    weekdays: number[];
    startHour: number;
    endHour: number;
    trackingMode: string;
  }>;
}
