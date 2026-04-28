import Foundation

struct FocusSettings: Codable {
    var userId: String
    var deviceId: String
    var syncServerUrl: String
    var encryptionKey: String
}

struct ActivitySession: Codable, Identifiable {
    var id: String
    var userId: String
    var deviceId: String
    var deviceType: String
    var source: String
    var appName: String
    var windowTitle: String
    var pageUrl: String
    var category: String
    var productivity: String
    var tag: String
    var startTs: String
    var endTs: String
    var createdAt: String
}

struct SyncEnvelope: Codable {
    var version: Int
    var alg: String
    var nonce: String
    var ciphertext: String
}

struct SyncEvent: Codable {
    var eventId: String
    var sourceDeviceId: String
    var sourceDeviceType: String
    var startTs: String
    var endTs: String
    var envelope: SyncEnvelope
}
