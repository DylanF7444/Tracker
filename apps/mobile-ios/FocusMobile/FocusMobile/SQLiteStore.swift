import Foundation
import SQLite3

final class SQLiteStore {
    private var db: OpaquePointer?
    private let dbPath: String

    init() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        dbPath = docs.appendingPathComponent("focus-mobile.db").path
        open()
        createTables()
    }

    deinit {
        sqlite3_close(db)
    }

    private func open() {
        sqlite3_open(dbPath, &db)
    }

    private func createTables() {
        let sql = """
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          synced INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS sync_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        """
        sqlite3_exec(db, sql, nil, nil, nil)
    }

    func insert(session: ActivitySession, synced: Bool = false) {
        guard let payload = try? String(data: JSONEncoder().encode(session), encoding: .utf8) else { return }
        var stmt: OpaquePointer?
        let sql = "INSERT OR REPLACE INTO sessions (id, payload, synced) VALUES (?, ?, ?);"
        sqlite3_prepare_v2(db, sql, -1, &stmt, nil)
        sqlite3_bind_text(stmt, 1, (session.id as NSString).utf8String, -1, nil)
        sqlite3_bind_text(stmt, 2, (payload as NSString).utf8String, -1, nil)
        sqlite3_bind_int(stmt, 3, synced ? 1 : 0)
        sqlite3_step(stmt)
        sqlite3_finalize(stmt)
    }

    func unsyncedSessions() -> [ActivitySession] {
        var result: [ActivitySession] = []
        var stmt: OpaquePointer?
        sqlite3_prepare_v2(db, "SELECT payload FROM sessions WHERE synced = 0;", -1, &stmt, nil)
        while sqlite3_step(stmt) == SQLITE_ROW {
            if let ptr = sqlite3_column_text(stmt, 0) {
                let payload = String(cString: ptr)
                if let data = payload.data(using: .utf8),
                   let decoded = try? JSONDecoder().decode(ActivitySession.self, from: data) {
                    result.append(decoded)
                }
            }
        }
        sqlite3_finalize(stmt)
        return result
    }

    func markSynced(ids: [String]) {
        guard !ids.isEmpty else { return }
        for id in ids {
            var stmt: OpaquePointer?
            sqlite3_prepare_v2(db, "UPDATE sessions SET synced = 1 WHERE id = ?;", -1, &stmt, nil)
            sqlite3_bind_text(stmt, 1, (id as NSString).utf8String, -1, nil)
            sqlite3_step(stmt)
            sqlite3_finalize(stmt)
        }
    }

    func allSessions() -> [ActivitySession] {
        var result: [ActivitySession] = []
        var stmt: OpaquePointer?
        sqlite3_prepare_v2(db, "SELECT payload FROM sessions;", -1, &stmt, nil)
        while sqlite3_step(stmt) == SQLITE_ROW {
            if let ptr = sqlite3_column_text(stmt, 0) {
                let payload = String(cString: ptr)
                if let data = payload.data(using: .utf8),
                   let decoded = try? JSONDecoder().decode(ActivitySession.self, from: data) {
                    result.append(decoded)
                }
            }
        }
        sqlite3_finalize(stmt)
        return result.sorted { $0.startTs < $1.startTs }
    }

    func getCursor() -> Int {
        var stmt: OpaquePointer?
        sqlite3_prepare_v2(db, "SELECT value FROM sync_state WHERE key = 'cursor';", -1, &stmt, nil)
        defer { sqlite3_finalize(stmt) }
        if sqlite3_step(stmt) == SQLITE_ROW, let ptr = sqlite3_column_text(stmt, 0) {
            return Int(String(cString: ptr)) ?? 0
        }
        return 0
    }

    func setCursor(_ value: Int) {
        var stmt: OpaquePointer?
        sqlite3_prepare_v2(
            db,
            "INSERT OR REPLACE INTO sync_state (key, value) VALUES ('cursor', ?);",
            -1,
            &stmt,
            nil
        )
        sqlite3_bind_text(stmt, 1, ("\(value)" as NSString).utf8String, -1, nil)
        sqlite3_step(stmt)
        sqlite3_finalize(stmt)
    }
}
