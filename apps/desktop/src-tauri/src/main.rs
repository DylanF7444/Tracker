#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::{DateTime, Datelike, Duration as ChronoDuration, NaiveDate, Utc};
use device_query::{DeviceQuery, DeviceState, Keycode, MouseState};
use rand::RngCore;
use reqwest::Client;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::State;
use url::Url;
use uuid::Uuid;
#[cfg(target_os = "macos")]
use std::process::Command;
#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CategoryRule {
    id: String,
    pattern: String,
    category: String,
    productivity: String,
    applies_to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoalRule {
    id: String,
    target_type: String,
    target: String,
    minutes_limit: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScheduleRule {
    id: String,
    name: String,
    weekdays: Vec<u32>,
    start_hour: u32,
    end_hour: u32,
    tracking_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FocusSettings {
    user_id: String,
    device_id: String,
    sync_server_url: String,
    encryption_key: String,
    idle_threshold_seconds: u64,
    excluded_apps: Vec<String>,
    blocked_apps: Vec<String>,
    blocked_domains: Vec<String>,
    category_rules: Vec<CategoryRule>,
    goals: Vec<GoalRule>,
    schedules: Vec<ScheduleRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActivitySession {
    id: String,
    user_id: String,
    device_id: String,
    device_type: String,
    source: String,
    app_name: String,
    window_title: String,
    page_url: String,
    category: String,
    productivity: String,
    tag: String,
    start_ts: String,
    end_ts: String,
    created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserEvent {
    app_name: String,
    page_url: String,
    page_title: String,
    start_ts: String,
    end_ts: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TimelineSegment {
    id: String,
    label: String,
    category: String,
    start_ts: String,
    end_ts: String,
    page_url: String,
    tag: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TimelineRow {
    device_type: String,
    device_id: String,
    segments: Vec<TimelineSegment>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TopUsageItem {
    key: String,
    category: String,
    minutes: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WeeklyTrendItem {
    day: String,
    focus_score: i64,
    productivity: i64,
    communication: i64,
    entertainment: i64,
    neutral: i64,
    distracting: i64,
    meeting: i64,
    #[serde(rename = "break")]
    break_minutes: i64,
    system: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DashboardStats {
    total_screen_minutes: i64,
    deep_focus_minutes: i64,
    top_app: String,
    phone_pickups: i64,
    focus_score: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DashboardSnapshot {
    stats: DashboardStats,
    timeline_rows: Vec<TimelineRow>,
    top_usage: Vec<TopUsageItem>,
    weekly_trend: Vec<WeeklyTrendItem>,
    goal_alerts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncEnvelope {
    version: u8,
    alg: String,
    nonce: String,
    ciphertext: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncEvent {
    event_id: String,
    source_device_id: String,
    source_device_type: String,
    start_ts: String,
    end_ts: String,
    envelope: SyncEnvelope,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncPushResponse {
    cursor: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncPullResponse {
    cursor: i64,
    events: Vec<SyncPulledEvent>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncPulledEvent {
    event_id: String,
    envelope: SyncEnvelope,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncStatusResponse {
    devices: Vec<SyncStatusDevice>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncStatusDevice {
    device_type: String,
    online: bool,
}

struct RuntimeState {
    tracking: bool,
    sync_status: String,
    stop_flag: Option<std::sync::Arc<AtomicBool>>,
}

struct AppState {
    db_path: PathBuf,
    runtime: Mutex<RuntimeState>,
    focus_mode: std::sync::Arc<AtomicBool>,
}

fn default_settings() -> FocusSettings {
    FocusSettings {
        user_id: "demo-user".to_string(),
        device_id: format!("desktop-{}", Uuid::new_v4()),
        sync_server_url: "http://localhost:8787".to_string(),
        encryption_key: "change-this-encryption-key".to_string(),
        idle_threshold_seconds: 180,
        excluded_apps: vec!["1password".into(), "bank".into()],
        blocked_apps: vec!["youtube".into()],
        blocked_domains: vec!["youtube.com".into(), "reddit.com".into()],
        category_rules: vec![
            CategoryRule {
                id: "r-vscode".into(),
                pattern: "code".into(),
                category: "productivity".into(),
                productivity: "productive".into(),
                applies_to: "app".into(),
            },
            CategoryRule {
                id: "r-slack".into(),
                pattern: "slack".into(),
                category: "communication".into(),
                productivity: "neutral".into(),
                applies_to: "app".into(),
            },
            CategoryRule {
                id: "r-youtube".into(),
                pattern: "youtube.com".into(),
                category: "entertainment".into(),
                productivity: "distracting".into(),
                applies_to: "domain".into(),
            },
        ],
        goals: vec![GoalRule {
            id: "goal-distracting".into(),
            target_type: "category".into(),
            target: "distracting".into(),
            minutes_limit: 30,
        }],
        schedules: vec![ScheduleRule {
            id: "sched-work".into(),
            name: "Work hours".into(),
            weekdays: vec![1, 2, 3, 4, 5],
            start_hour: 9,
            end_hour: 18,
            tracking_mode: "work".into(),
        }],
    }
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

fn init_db(path: &PathBuf) -> Result<(), String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS activity_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          device_id TEXT NOT NULL,
          device_type TEXT NOT NULL,
          source TEXT NOT NULL,
          app_name TEXT NOT NULL,
          window_title TEXT NOT NULL,
          page_url TEXT NOT NULL,
          category TEXT NOT NULL,
          productivity TEXT NOT NULL,
          tag TEXT NOT NULL,
          start_ts TEXT NOT NULL,
          end_ts TEXT NOT NULL,
          created_at TEXT NOT NULL,
          synced INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_start_end
        ON activity_sessions(start_ts, end_ts);

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sync_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
    "#,
    )
    .map_err(|e| e.to_string())?;

    let count: i64 = conn
        .query_row("SELECT COUNT(1) FROM settings WHERE key = 'focus_settings'", [], |row| {
            row.get(0)
        })
        .map_err(|e| e.to_string())?;

    if count == 0 {
        let value = serde_json::to_string(&default_settings()).map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('focus_settings', ?1)",
            params![value],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn load_settings(path: &PathBuf) -> Result<FocusSettings, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    let value: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'focus_settings'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    serde_json::from_str(&value).map_err(|e| e.to_string())
}

fn save_settings_internal(path: &PathBuf, settings: &FocusSettings) -> Result<(), String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    let payload = serde_json::to_string(settings).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('focus_settings', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![payload],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn cursor_get(path: &PathBuf) -> Result<i64, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    let value: Result<String, _> =
        conn.query_row("SELECT value FROM sync_state WHERE key = 'cursor'", [], |row| row.get(0));
    match value {
        Ok(v) => Ok(v.parse::<i64>().unwrap_or(0)),
        Err(_) => Ok(0),
    }
}

fn cursor_set(path: &PathBuf, cursor: i64) -> Result<(), String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO sync_state (key, value) VALUES ('cursor', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![cursor.to_string()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn insert_session(path: &PathBuf, session: &ActivitySession, synced: bool) -> Result<(), String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO activity_sessions (
            id, user_id, device_id, device_type, source, app_name, window_title, page_url,
            category, productivity, tag, start_ts, end_ts, created_at, synced
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
         ON CONFLICT(id) DO UPDATE SET
           app_name = excluded.app_name,
           window_title = excluded.window_title,
           page_url = excluded.page_url,
           category = excluded.category,
           productivity = excluded.productivity,
           tag = excluded.tag,
           start_ts = excluded.start_ts,
           end_ts = excluded.end_ts,
           synced = excluded.synced",
        params![
            session.id,
            session.user_id,
            session.device_id,
            session.device_type,
            session.source,
            session.app_name,
            session.window_title,
            session.page_url,
            session.category,
            session.productivity,
            session.tag,
            session.start_ts,
            session.end_ts,
            session.created_at,
            if synced { 1 } else { 0 }
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn utf16_to_string(value: &[u16]) -> String {
    let end = value.iter().position(|v| *v == 0).unwrap_or(value.len());
    String::from_utf16_lossy(&value[..end])
}

#[cfg(target_os = "windows")]
fn process_name_from_pid(pid: u32) -> Option<String> {
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return None;
        }

        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

        let mut process_name = None;
        if Process32FirstW(snapshot, &mut entry) != 0 {
            loop {
                if entry.th32ProcessID == pid {
                    let mut name = utf16_to_string(&entry.szExeFile);
                    if let Some(stripped) = name.strip_suffix(".exe") {
                        name = stripped.to_string();
                    }
                    process_name = Some(name);
                    break;
                }

                if Process32NextW(snapshot, &mut entry) == 0 {
                    break;
                }
            }
        }

        CloseHandle(snapshot);
        process_name
    }
}

#[cfg(target_os = "windows")]
fn get_active_window() -> Option<(String, String)> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return None;
        }

        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 {
            return None;
        }

        let title_len = GetWindowTextLengthW(hwnd);
        let mut title_buf = vec![0u16; title_len as usize + 1];
        let copied = GetWindowTextW(hwnd, title_buf.as_mut_ptr(), title_buf.len() as i32);
        let title = if copied > 0 {
            String::from_utf16_lossy(&title_buf[..copied as usize])
                .trim()
                .to_string()
        } else {
            String::new()
        };

        let app = process_name_from_pid(pid)?;
        Some((app, title))
    }
}

#[cfg(target_os = "macos")]
fn get_active_window() -> Option<(String, String)> {
    let script = r#"tell application "System Events"
set frontApp to name of first application process whose frontmost is true
end tell
tell application frontApp to set winTitle to ""
return frontApp & "||" & winTitle"#;

    let output = Command::new("osascript").args(["-e", script]).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    let line = text.lines().find(|l| !l.trim().is_empty())?;
    let mut parts = line.splitn(2, "||");
    let app = parts.next()?.trim().to_string();
    let title = parts.next().unwrap_or("").trim().to_string();
    Some((app, title))
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn get_active_window() -> Option<(String, String)> {
    None
}

fn parse_domain(url: &str) -> String {
    Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.domain().map(|d| d.to_string()))
        .unwrap_or_default()
}

fn classify(settings: &FocusSettings, app_name: &str, page_url: &str, title: &str) -> (String, String) {
    let app = app_name.to_lowercase();
    let domain = parse_domain(page_url).to_lowercase();
    let ttl = title.to_lowercase();
    for rule in &settings.category_rules {
        let pattern = rule.pattern.to_lowercase();
        let haystack = match rule.applies_to.as_str() {
            "app" => &app,
            "domain" => &domain,
            _ => &ttl,
        };
        if !pattern.is_empty() && haystack.contains(&pattern) {
            return (rule.category.clone(), rule.productivity.clone());
        }
    }
    ("neutral".into(), "neutral".into())
}

fn parse_ts(ts: &str) -> Result<DateTime<Utc>, String> {
    DateTime::parse_from_rfc3339(ts)
        .map(|d| d.with_timezone(&Utc))
        .map_err(|e| e.to_string())
}

fn session_minutes(session: &ActivitySession) -> i64 {
    let start = match parse_ts(&session.start_ts) {
        Ok(v) => v,
        Err(_) => return 0,
    };
    let end = match parse_ts(&session.end_ts) {
        Ok(v) => v,
        Err(_) => return 0,
    };
    ((end - start).num_seconds().max(0)) / 60
}

fn load_sessions_between(path: &PathBuf, day_start: DateTime<Utc>, day_end: DateTime<Utc>) -> Result<Vec<ActivitySession>, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, user_id, device_id, device_type, source, app_name, window_title, page_url,
                    category, productivity, tag, start_ts, end_ts, created_at
             FROM activity_sessions
             WHERE start_ts < ?1 AND end_ts > ?2
             ORDER BY start_ts ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![day_end.to_rfc3339(), day_start.to_rfc3339()], |row| {
            Ok(ActivitySession {
                id: row.get(0)?,
                user_id: row.get(1)?,
                device_id: row.get(2)?,
                device_type: row.get(3)?,
                source: row.get(4)?,
                app_name: row.get(5)?,
                window_title: row.get(6)?,
                page_url: row.get(7)?,
                category: row.get(8)?,
                productivity: row.get(9)?,
                tag: row.get(10)?,
                start_ts: row.get(11)?,
                end_ts: row.get(12)?,
                created_at: row.get(13)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn build_weekly_trend(path: &PathBuf, day_end: DateTime<Utc>) -> Result<Vec<WeeklyTrendItem>, String> {
    let mut result = Vec::new();
    for offset in (0..7).rev() {
        let day = day_end.date_naive() - ChronoDuration::days(offset);
        let start = DateTime::<Utc>::from_naive_utc_and_offset(day.and_hms_opt(0, 0, 0).unwrap(), Utc);
        let end = start + ChronoDuration::days(1);
        let sessions = load_sessions_between(path, start, end)?;
        let mut cat: HashMap<String, i64> = HashMap::new();
        let mut productive = 0;
        let mut distracting = 0;
        for session in sessions {
            let mins = session_minutes(&session);
            *cat.entry(session.category.clone()).or_insert(0) += mins;
            if session.productivity == "productive" {
                productive += mins;
            }
            if session.productivity == "distracting" {
                distracting += mins;
            }
        }
        let total = productive + distracting;
        let focus_score = if total == 0 { 50 } else { (productive * 100 / total).clamp(0, 100) };

        result.push(WeeklyTrendItem {
            day: format!("{:02}-{:02}", day.month(), day.day()),
            focus_score,
            productivity: *cat.get("productivity").unwrap_or(&0),
            communication: *cat.get("communication").unwrap_or(&0),
            entertainment: *cat.get("entertainment").unwrap_or(&0),
            neutral: *cat.get("neutral").unwrap_or(&0),
            distracting: *cat.get("distracting").unwrap_or(&0),
            meeting: *cat.get("meeting").unwrap_or(&0),
            break_minutes: *cat.get("break").unwrap_or(&0),
            system: *cat.get("system").unwrap_or(&0),
        });
    }
    Ok(result)
}

fn build_dashboard(path: &PathBuf, day: Option<String>) -> Result<DashboardSnapshot, String> {
    let day_naive = if let Some(value) = day {
        NaiveDate::parse_from_str(&value, "%Y-%m-%d").map_err(|e| e.to_string())?
    } else {
        Utc::now().date_naive()
    };
    let day_start = DateTime::<Utc>::from_naive_utc_and_offset(day_naive.and_hms_opt(0, 0, 0).unwrap(), Utc);
    let day_end = day_start + ChronoDuration::days(1);

    let settings = load_settings(path)?;
    let sessions = load_sessions_between(path, day_start, day_end)?;

    let mut rows: HashMap<(String, String), Vec<TimelineSegment>> = HashMap::new();
    let mut top_usage_map: HashMap<(String, String), i64> = HashMap::new();
    let mut total_screen = 0;
    let mut deep_focus = 0;
    let mut phone_pickups = 0;
    let mut productive = 0;
    let mut distracting = 0;

    for session in &sessions {
        let mins = session_minutes(session);
        total_screen += mins;
        if session.tag.eq_ignore_ascii_case("deep work") || session.productivity == "productive" {
            deep_focus += mins;
        }
        if session.source == "mobile-usage" && session.app_name.eq_ignore_ascii_case("unlock event") {
            phone_pickups += 1;
        }
        if session.productivity == "productive" {
            productive += mins;
        }
        if session.productivity == "distracting" {
            distracting += mins;
        }

        rows.entry((session.device_type.clone(), session.device_id.clone()))
            .or_default()
            .push(TimelineSegment {
                id: session.id.clone(),
                label: if !session.app_name.is_empty() {
                    session.app_name.clone()
                } else {
                    session.window_title.clone()
                },
                category: session.category.clone(),
                start_ts: session.start_ts.clone(),
                end_ts: session.end_ts.clone(),
                page_url: session.page_url.clone(),
                tag: session.tag.clone(),
            });

        let usage_key = if !session.page_url.is_empty() {
            parse_domain(&session.page_url)
        } else {
            session.app_name.clone()
        };
        let map_key = (usage_key, session.category.clone());
        *top_usage_map.entry(map_key).or_insert(0) += mins;
    }

    let focus_total = productive + distracting;
    let focus_score = if focus_total == 0 {
        50
    } else {
        (productive * 100 / focus_total).clamp(0, 100)
    };

    let top_app = top_usage_map
        .iter()
        .max_by_key(|(_, mins)| **mins)
        .map(|((name, _), _)| name.clone())
        .unwrap_or_else(|| "-".into());

    let mut top_usage: Vec<TopUsageItem> = top_usage_map
        .into_iter()
        .map(|((key, category), minutes)| TopUsageItem {
            key,
            category,
            minutes,
        })
        .collect();
    top_usage.sort_by(|a, b| b.minutes.cmp(&a.minutes));
    top_usage.truncate(10);

    let mut timeline_rows: Vec<TimelineRow> = rows
        .into_iter()
        .map(|((device_type, device_id), mut segments)| {
            segments.sort_by(|a, b| a.start_ts.cmp(&b.start_ts));
            TimelineRow {
                device_type,
                device_id,
                segments,
            }
        })
        .collect();
    timeline_rows.sort_by(|a, b| a.device_type.cmp(&b.device_type));

    let mut goal_alerts = Vec::new();
    for goal in settings.goals {
        let consumed = if goal.target_type == "category" {
            sessions
                .iter()
                .filter(|s| s.category.eq_ignore_ascii_case(&goal.target))
                .map(session_minutes)
                .sum::<i64>()
        } else {
            sessions
                .iter()
                .filter(|s| s.app_name.eq_ignore_ascii_case(&goal.target))
                .map(session_minutes)
                .sum::<i64>()
        };

        if consumed > goal.minutes_limit {
            goal_alerts.push(format!(
                "Goal exceeded: {} {} ({}m / {}m)",
                goal.target_type, goal.target, consumed, goal.minutes_limit
            ));
        }
    }

    Ok(DashboardSnapshot {
        stats: DashboardStats {
            total_screen_minutes: total_screen,
            deep_focus_minutes: deep_focus,
            top_app,
            phone_pickups,
            focus_score,
        },
        timeline_rows,
        top_usage,
        weekly_trend: build_weekly_trend(path, day_end)?,
        goal_alerts,
    })
}

fn derive_key(secret: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    let bytes = hasher.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    key
}

fn encrypt_payload(secret: &str, plaintext: &str) -> Result<SyncEnvelope, String> {
    let key = derive_key(secret);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| e.to_string())?;
    Ok(SyncEnvelope {
        version: 1,
        alg: "aes-256-gcm".into(),
        nonce: BASE64.encode(nonce_bytes),
        ciphertext: BASE64.encode(ciphertext),
    })
}

fn decrypt_payload(secret: &str, envelope: &SyncEnvelope) -> Result<String, String> {
    let key = derive_key(secret);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let nonce_raw = BASE64.decode(&envelope.nonce).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(&nonce_raw);
    let ciphertext = BASE64
        .decode(&envelope.ciphertext)
        .map_err(|e| e.to_string())?;
    let plaintext = cipher.decrypt(nonce, ciphertext.as_ref()).map_err(|e| e.to_string())?;
    String::from_utf8(plaintext).map_err(|e| e.to_string())
}

fn tracking_loop(
    db_path: PathBuf,
    settings: FocusSettings,
    stop_flag: std::sync::Arc<AtomicBool>,
    focus_mode: std::sync::Arc<AtomicBool>,
) {
    let device_state = DeviceState::new();
    let mut last_mouse: MouseState = device_state.get_mouse();
    let mut last_keys: Vec<Keycode> = device_state.get_keys();
    let mut last_input = Instant::now();
    let mut current: Option<ActivitySession> = None;
    loop {
        if stop_flag.load(Ordering::Relaxed) {
            if let Some(mut active) = current.take() {
                active.end_ts = now_iso();
                let _ = insert_session(&db_path, &active, false);
            }
            break;
        }

        let mouse = device_state.get_mouse();
        let keys = device_state.get_keys();
        if mouse.coords != last_mouse.coords || keys != last_keys {
            last_input = Instant::now();
            last_mouse = mouse;
            last_keys = keys;
        }

        let is_idle = last_input.elapsed().as_secs() >= settings.idle_threshold_seconds;
        if is_idle {
            if let Some(mut active) = current.take() {
                active.end_ts = now_iso();
                let _ = insert_session(&db_path, &active, false);
            }
            std::thread::sleep(Duration::from_secs(5));
            continue;
        }

        let Some((app_name, title)) = get_active_window() else {
            std::thread::sleep(Duration::from_secs(5));
            continue;
        };

        let app_lower = app_name.to_lowercase();
        if settings.excluded_apps.iter().any(|a| app_lower.contains(&a.to_lowercase())) {
            if let Some(mut active) = current.take() {
                active.end_ts = now_iso();
                let _ = insert_session(&db_path, &active, false);
            }
            std::thread::sleep(Duration::from_secs(5));
            continue;
        }

        if let Some(active) = &current {
            if active.app_name != app_name || active.window_title != title {
                let mut closed = active.clone();
                closed.end_ts = now_iso();
                let _ = insert_session(&db_path, &closed, false);
                current = None;
            }
        }

        if current.is_none() {
            let (mut category, mut productivity) = classify(&settings, &app_name, "", &title);
            if focus_mode.load(Ordering::Relaxed)
                && settings.blocked_apps.iter().any(|a| app_lower.contains(&a.to_lowercase()))
            {
                category = "distracting".into();
                productivity = "distracting".into();
            }

            current = Some(ActivitySession {
                id: Uuid::new_v4().to_string(),
                user_id: settings.user_id.clone(),
                device_id: settings.device_id.clone(),
                device_type: "desktop".into(),
                source: "desktop-window".into(),
                app_name,
                window_title: title,
                page_url: String::new(),
                category,
                productivity,
                tag: String::new(),
                start_ts: now_iso(),
                end_ts: now_iso(),
                created_at: now_iso(),
            });
        }

        std::thread::sleep(Duration::from_secs(5));
    }
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Result<FocusSettings, String> {
    load_settings(&state.db_path)
}

#[tauri::command]
fn save_settings(state: State<'_, AppState>, settings: FocusSettings) -> Result<(), String> {
    save_settings_internal(&state.db_path, &settings)
}

#[tauri::command]
fn get_dashboard_snapshot(state: State<'_, AppState>, day: Option<String>) -> Result<DashboardSnapshot, String> {
    build_dashboard(&state.db_path, day)
}

#[tauri::command]
fn is_tracking_active(state: State<'_, AppState>) -> Result<bool, String> {
    let runtime = state.runtime.lock().map_err(|_| "Failed to acquire runtime lock".to_string())?;
    Ok(runtime.tracking)
}

#[tauri::command]
fn get_sync_status(state: State<'_, AppState>) -> Result<String, String> {
    let runtime = state.runtime.lock().map_err(|_| "Failed to acquire runtime lock".to_string())?;
    Ok(runtime.sync_status.clone())
}

#[tauri::command]
fn set_focus_mode(state: State<'_, AppState>, enabled: bool) {
    state.focus_mode.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
async fn start_tracking(state: State<'_, AppState>) -> Result<(), String> {
    let settings = load_settings(&state.db_path)?;
    let mut runtime = state.runtime.lock().map_err(|_| "Failed to acquire runtime lock".to_string())?;
    if runtime.tracking {
        return Ok(());
    }
    let stop_flag = std::sync::Arc::new(AtomicBool::new(false));
    runtime.tracking = true;
    runtime.sync_status = "Tracking active".into();
    runtime.stop_flag = Some(stop_flag.clone());
    drop(runtime);

    let db_path = state.db_path.clone();
    let focus_mode = state.focus_mode.clone();
    std::thread::spawn(move || tracking_loop(db_path, settings, stop_flag, focus_mode));
    Ok(())
}

#[tauri::command]
fn stop_tracking(state: State<'_, AppState>) -> Result<(), String> {
    let mut runtime = state.runtime.lock().map_err(|_| "Failed to acquire runtime lock".to_string())?;
    if let Some(flag) = &runtime.stop_flag {
        flag.store(true, Ordering::Relaxed);
    }
    runtime.stop_flag = None;
    runtime.tracking = false;
    runtime.sync_status = "Tracking paused".into();
    Ok(())
}

#[tauri::command]
fn ingest_browser_event(state: State<'_, AppState>, event: BrowserEvent) -> Result<(), String> {
    let settings = load_settings(&state.db_path)?;
    let app_name = if event.app_name.is_empty() {
        parse_domain(&event.page_url)
    } else {
        event.app_name.clone()
    };
    let (mut category, mut productivity) = classify(&settings, &app_name, &event.page_url, &event.page_title);
    let domain = parse_domain(&event.page_url).to_lowercase();
    if state.focus_mode.load(Ordering::Relaxed)
        && settings
            .blocked_domains
            .iter()
            .any(|blocked| domain.contains(&blocked.to_lowercase()))
    {
        category = "distracting".into();
        productivity = "distracting".into();
    }

    let session = ActivitySession {
        id: Uuid::new_v4().to_string(),
        user_id: settings.user_id,
        device_id: settings.device_id,
        device_type: "desktop".into(),
        source: "browser-tab".into(),
        app_name,
        window_title: event.page_title,
        page_url: event.page_url,
        category,
        productivity,
        tag: String::new(),
        start_ts: event.start_ts,
        end_ts: event.end_ts,
        created_at: now_iso(),
    };

    insert_session(&state.db_path, &session, false)
}

#[tauri::command]
fn manual_tag_session(
    state: State<'_, AppState>,
    tag: String,
    start_ts: String,
    end_ts: String,
    label: String,
) -> Result<(), String> {
    let settings = load_settings(&state.db_path)?;
    let session = ActivitySession {
        id: Uuid::new_v4().to_string(),
        user_id: settings.user_id,
        device_id: settings.device_id,
        device_type: "desktop".into(),
        source: "manual-tag".into(),
        app_name: label.clone(),
        window_title: label,
        page_url: String::new(),
        category: "neutral".into(),
        productivity: "neutral".into(),
        tag,
        start_ts,
        end_ts,
        created_at: now_iso(),
    };
    insert_session(&state.db_path, &session, false)
}

#[tauri::command]
async fn sync_now(state: State<'_, AppState>) -> Result<(), String> {
    {
        let mut runtime = state.runtime.lock().map_err(|_| "Failed to acquire runtime lock".to_string())?;
        runtime.sync_status = "Syncing...".into();
    }

    let settings = load_settings(&state.db_path)?;
    if settings.sync_server_url.trim().is_empty() {
        return Err("syncServerUrl is empty in settings".into());
    }

    let unsynced_rows = {
        let conn = Connection::open(&state.db_path).map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, user_id, device_id, device_type, source, app_name, window_title, page_url,
                        category, productivity, tag, start_ts, end_ts, created_at
                 FROM activity_sessions
                 WHERE synced = 0
                 ORDER BY start_ts ASC
                 LIMIT 500",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
            Ok(ActivitySession {
                id: row.get(0)?,
                user_id: row.get(1)?,
                device_id: row.get(2)?,
                device_type: row.get(3)?,
                source: row.get(4)?,
                app_name: row.get(5)?,
                window_title: row.get(6)?,
                page_url: row.get(7)?,
                category: row.get(8)?,
                productivity: row.get(9)?,
                tag: row.get(10)?,
                start_ts: row.get(11)?,
                end_ts: row.get(12)?,
                created_at: row.get(13)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
        rows
    };

    let events: Vec<SyncEvent> = unsynced_rows
        .iter()
        .map(|session| {
            let payload = serde_json::to_string(session).map_err(|e| e.to_string())?;
            let envelope = encrypt_payload(&settings.encryption_key, &payload)?;
            Ok(SyncEvent {
                event_id: session.id.clone(),
                source_device_id: settings.device_id.clone(),
                source_device_type: "desktop".into(),
                start_ts: session.start_ts.clone(),
                end_ts: session.end_ts.clone(),
                envelope,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    let client = Client::new();
    let push_url = format!("{}/v1/sync/push", settings.sync_server_url.trim_end_matches('/'));
    let push_resp = client
        .post(push_url)
        .json(&json!({
            "userId": settings.user_id,
            "deviceId": settings.device_id,
            "deviceType": "desktop",
            "events": events
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json::<SyncPushResponse>()
        .await
        .map_err(|e| e.to_string())?;

    if !unsynced_rows.is_empty() {
        let mut conn = Connection::open(&state.db_path).map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for session in &unsynced_rows {
            tx.execute(
                "UPDATE activity_sessions SET synced = 1 WHERE id = ?1",
                params![session.id],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
    }

    let pull_url = format!("{}/v1/sync/pull", settings.sync_server_url.trim_end_matches('/'));
    let since_cursor = cursor_get(&state.db_path)?;
    let pull_resp = client
        .get(pull_url)
        .query(&[
            ("userId", settings.user_id.as_str()),
            ("deviceId", settings.device_id.as_str()),
            ("deviceType", "desktop"),
            ("sinceCursor", &since_cursor.to_string()),
            ("limit", "500"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json::<SyncPullResponse>()
        .await
        .map_err(|e| e.to_string())?;

    for event in pull_resp.events {
        let plaintext = decrypt_payload(&settings.encryption_key, &event.envelope)?;
        let session = serde_json::from_str::<ActivitySession>(&plaintext).map_err(|e| e.to_string())?;
        insert_session(&state.db_path, &session, true)?;
    }

    cursor_set(&state.db_path, pull_resp.cursor.max(push_resp.cursor))?;

    let status_url = format!("{}/v1/sync/status", settings.sync_server_url.trim_end_matches('/'));
    let status_resp = client
        .get(status_url)
        .query(&[("userId", settings.user_id.as_str())])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json::<SyncStatusResponse>()
        .await
        .map_err(|e| e.to_string())?;

    let phone_online = status_resp
        .devices
        .iter()
        .any(|device| device.device_type == "mobile" && device.online);
    let sync_status = if phone_online {
        "All devices synced"
    } else {
        "Phone offline"
    };

    let mut runtime = state.runtime.lock().map_err(|_| "Failed to acquire runtime lock".to_string())?;
    runtime.sync_status = sync_status.into();
    Ok(())
}

fn main() {
    let mut db_path = std::env::current_dir().expect("failed to resolve current directory");
    db_path.push("data");
    std::fs::create_dir_all(&db_path).expect("failed to create data directory");
    db_path.push("focus-desktop.db");
    init_db(&db_path).expect("failed to initialize local database");

    tauri::Builder::default()
        .manage(AppState {
            db_path,
            runtime: Mutex::new(RuntimeState {
                tracking: false,
                sync_status: "Syncing...".into(),
                stop_flag: None,
            }),
            focus_mode: std::sync::Arc::new(AtomicBool::new(false)),
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            get_dashboard_snapshot,
            is_tracking_active,
            get_sync_status,
            set_focus_mode,
            start_tracking,
            stop_tracking,
            ingest_browser_event,
            manual_tag_session,
            sync_now
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
