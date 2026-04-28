import Foundation

@MainActor
final class FocusViewModel: ObservableObject {
    @Published var sessions: [ActivitySession] = []
    @Published var syncStatus: String = "Idle"
    @Published var settings: FocusSettings

    private let store: SQLiteStore
    private let collector: ActivityCollector

    init() {
        self.settings = FocusSettings(
            userId: "demo-user",
            deviceId: "ios-\(UUID().uuidString)",
            syncServerUrl: "http://localhost:8787",
            encryptionKey: "change-this-encryption-key"
        )
        let store = SQLiteStore()
        self.store = store
        self.collector = ActivityCollector(store: store, settings: settings)
        refreshSessions()
        collector.start()
    }

    func refreshSessions() {
        sessions = store.allSessions()
    }

    func addTag(_ tag: String) {
        collector.recordManualTag(tag: tag, minutes: 25)
        refreshSessions()
    }

    func ingestSampleForegroundUsage() {
        collector.ingestForegroundDurations([
            (appName: "Xcode", seconds: 1800),
            (appName: "Slack", seconds: 600)
        ])
        refreshSessions()
    }

    func syncNow() async {
        syncStatus = "Syncing..."
        do {
            try await SyncClient(store: store, settings: settings).syncNow()
            refreshSessions()
            syncStatus = "All devices synced"
        } catch {
            syncStatus = "Phone offline"
        }
    }
}
