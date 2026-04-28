package com.focus.mobile

import androidx.room.Entity
import androidx.room.PrimaryKey
import java.time.Instant
import java.util.UUID

@Entity(tableName = "sessions")
data class ActivitySessionEntity(
    @PrimaryKey val id: String = UUID.randomUUID().toString(),
    val userId: String,
    val deviceId: String,
    val deviceType: String = "mobile",
    val source: String,
    val appName: String,
    val windowTitle: String,
    val pageUrl: String = "",
    val category: String,
    val productivity: String,
    val tag: String = "",
    val startTs: String,
    val endTs: String,
    val createdAt: String = Instant.now().toString(),
    val synced: Boolean = false
)

data class FocusSettings(
    val userId: String = "demo-user",
    val deviceId: String = "android-${UUID.randomUUID()}",
    val syncServerUrl: String = "http://10.0.2.2:8787",
    val encryptionKey: String = "change-this-encryption-key"
)

data class SyncEnvelope(
    val version: Int = 1,
    val alg: String = "aes-256-gcm",
    val nonce: String,
    val ciphertext: String
)
