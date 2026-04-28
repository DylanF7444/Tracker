import DeviceActivity
import Foundation
import UIKit

final class ActivityCollector {
    private let store: SQLiteStore
    private let settings: FocusSettings
    private var unlockObserver: NSObjectProtocol?

    init(store: SQLiteStore, settings: FocusSettings) {
        self.store = store
        self.settings = settings
    }

    func start() {
        // iOS Screen Time data access requires FamilyControls entitlements and a DeviceActivity report extension.
        // This hook enables unlock event ingestion and exposes APIs for report-extension data delivery.
        unlockObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.protectedDataDidBecomeAvailableNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.recordUnlockEvent()
        }
    }

    func stop() {
        if let unlockObserver {
            NotificationCenter.default.removeObserver(unlockObserver)
        }
    }

    func ingestForegroundDurations(_ samples: [(appName: String, seconds: Int)]) {
        let now = Date()
        for sample in samples where sample.seconds > 0 {
            let end = now
            let start = now.addingTimeInterval(TimeInterval(-sample.seconds))
            let session = ActivitySession(
                id: UUID().uuidString,
                userId: settings.userId,
                deviceId: settings.deviceId,
                deviceType: "mobile",
                source: "mobile-usage",
                appName: sample.appName,
                windowTitle: sample.appName,
                pageUrl: "",
                category: "neutral",
                productivity: "neutral",
                tag: "",
                startTs: ISO8601DateFormatter().string(from: start),
                endTs: ISO8601DateFormatter().string(from: end),
                createdAt: ISO8601DateFormatter().string(from: now)
            )
            store.insert(session: session)
        }
    }

    func recordManualTag(tag: String, minutes: Int) {
        let end = Date()
        let start = end.addingTimeInterval(TimeInterval(-(minutes * 60)))
        let session = ActivitySession(
            id: UUID().uuidString,
            userId: settings.userId,
            deviceId: settings.deviceId,
            deviceType: "mobile",
            source: "manual-tag",
            appName: tag,
            windowTitle: tag,
            pageUrl: "",
            category: "neutral",
            productivity: tag == "deep work" ? "productive" : "neutral",
            tag: tag,
            startTs: ISO8601DateFormatter().string(from: start),
            endTs: ISO8601DateFormatter().string(from: end),
            createdAt: ISO8601DateFormatter().string(from: end)
        )
        store.insert(session: session)
    }

    private func recordUnlockEvent() {
        let now = Date()
        let start = now.addingTimeInterval(-5)
        let session = ActivitySession(
            id: UUID().uuidString,
            userId: settings.userId,
            deviceId: settings.deviceId,
            deviceType: "mobile",
            source: "mobile-usage",
            appName: "Unlock Event",
            windowTitle: "Device unlock",
            pageUrl: "",
            category: "system",
            productivity: "neutral",
            tag: "pickup",
            startTs: ISO8601DateFormatter().string(from: start),
            endTs: ISO8601DateFormatter().string(from: now),
            createdAt: ISO8601DateFormatter().string(from: now)
        )
        store.insert(session: session)
    }
}
