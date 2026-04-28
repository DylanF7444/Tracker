import CryptoKit
import Foundation

final class SyncClient {
    private let store: SQLiteStore
    private let settings: FocusSettings

    init(store: SQLiteStore, settings: FocusSettings) {
        self.store = store
        self.settings = settings
    }

    private func envelope(for session: ActivitySession) throws -> SyncEnvelope {
        let key = SymmetricKey(data: SHA256.hash(data: Data(settings.encryptionKey.utf8)))
        let plaintext = try JSONEncoder().encode(session)
        let sealed = try AES.GCM.seal(plaintext, using: key)
        let payload = sealed.ciphertext + sealed.tag
        return SyncEnvelope(
            version: 1,
            alg: "aes-256-gcm",
            nonce: Data(sealed.nonce).base64EncodedString(),
            ciphertext: payload.base64EncodedString()
        )
    }

    private func decrypt(envelope: SyncEnvelope) throws -> ActivitySession {
        let key = SymmetricKey(data: SHA256.hash(data: Data(settings.encryptionKey.utf8)))
        guard
            let nonceData = Data(base64Encoded: envelope.nonce),
            let combinedData = Data(base64Encoded: envelope.ciphertext)
        else { throw URLError(.cannotDecodeRawData) }
        guard combinedData.count >= 16 else { throw URLError(.cannotDecodeRawData) }
        let cipherData = combinedData.prefix(combinedData.count - 16)
        let tagData = combinedData.suffix(16)
        let nonce = try AES.GCM.Nonce(data: nonceData)
        let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: cipherData, tag: tagData)
        let plain = try AES.GCM.open(box, using: key)
        return try JSONDecoder().decode(ActivitySession.self, from: plain)
    }

    func syncNow() async throws {
        let base = settings.syncServerUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let unsynced = store.unsyncedSessions()
        let events = try unsynced.map { session in
            SyncEvent(
                eventId: session.id,
                sourceDeviceId: settings.deviceId,
                sourceDeviceType: "mobile",
                startTs: session.startTs,
                endTs: session.endTs,
                envelope: try envelope(for: session)
            )
        }

        var pushRequest = URLRequest(url: URL(string: "\(base)/v1/sync/push")!)
        pushRequest.httpMethod = "POST"
        pushRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        pushRequest.httpBody = try JSONSerialization.data(withJSONObject: [
            "userId": settings.userId,
            "deviceId": settings.deviceId,
            "deviceType": "mobile",
            "events": events.map { event in
                [
                    "eventId": event.eventId,
                    "sourceDeviceId": event.sourceDeviceId,
                    "sourceDeviceType": event.sourceDeviceType,
                    "startTs": event.startTs,
                    "endTs": event.endTs,
                    "envelope": [
                        "version": event.envelope.version,
                        "alg": event.envelope.alg,
                        "nonce": event.envelope.nonce,
                        "ciphertext": event.envelope.ciphertext
                    ]
                ]
            }
        ])
        let (_, pushResponse) = try await URLSession.shared.data(for: pushRequest)
        guard (pushResponse as? HTTPURLResponse)?.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        store.markSynced(ids: unsynced.map(\.id))

        let cursor = store.getCursor()
        let pullURL = URL(
            string: "\(base)/v1/sync/pull?userId=\(settings.userId)&deviceId=\(settings.deviceId)&deviceType=mobile&sinceCursor=\(cursor)&limit=500"
        )!
        let (pullData, _) = try await URLSession.shared.data(from: pullURL)
        let payload = try JSONSerialization.jsonObject(with: pullData) as? [String: Any] ?? [:]
        let eventsArray = payload["events"] as? [[String: Any]] ?? []
        for item in eventsArray {
            guard
                let eventId = item["eventId"] as? String,
                let envelopeMap = item["envelope"] as? [String: Any],
                let version = envelopeMap["version"] as? Int,
                let alg = envelopeMap["alg"] as? String,
                let nonce = envelopeMap["nonce"] as? String,
                let ciphertext = envelopeMap["ciphertext"] as? String
            else { continue }

            let session = try decrypt(
                envelope: SyncEnvelope(version: version, alg: alg, nonce: nonce, ciphertext: ciphertext)
            )
            var merged = session
            merged.id = eventId
            store.insert(session: merged, synced: true)
        }

        if let cursorValue = payload["cursor"] as? Int {
            store.setCursor(cursorValue)
        }
    }
}
