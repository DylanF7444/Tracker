package com.focus.mobile

import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

class SyncRepository(
    private val dao: SessionDao,
    private val settings: FocusSettings
) {
    private val client = OkHttpClient()

    private fun encryptPayload(payload: String): SyncEnvelope {
        val digest = MessageDigest.getInstance("SHA-256").digest(settings.encryptionKey.toByteArray())
        val secret = SecretKeySpec(digest, "AES")
        val nonce = ByteArray(12).also { java.security.SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secret, GCMParameterSpec(128, nonce))
        val ciphertext = cipher.doFinal(payload.toByteArray())
        return SyncEnvelope(
            nonce = Base64.encodeToString(nonce, Base64.NO_WRAP),
            ciphertext = Base64.encodeToString(ciphertext, Base64.NO_WRAP)
        )
    }

    private fun decryptPayload(envelope: SyncEnvelope): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(settings.encryptionKey.toByteArray())
        val secret = SecretKeySpec(digest, "AES")
        val nonce = Base64.decode(envelope.nonce, Base64.NO_WRAP)
        val cipherData = Base64.decode(envelope.ciphertext, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, secret, GCMParameterSpec(128, nonce))
        return String(cipher.doFinal(cipherData))
    }

    suspend fun syncNow() = withContext(Dispatchers.IO) {
        val unsynced = dao.unsyncedSessions()
        val eventsJson = JSONArray()
        unsynced.forEach { session ->
            val payload = JSONObject()
                .put("id", session.id)
                .put("userId", session.userId)
                .put("deviceId", session.deviceId)
                .put("deviceType", session.deviceType)
                .put("source", session.source)
                .put("appName", session.appName)
                .put("windowTitle", session.windowTitle)
                .put("pageUrl", session.pageUrl)
                .put("category", session.category)
                .put("productivity", session.productivity)
                .put("tag", session.tag)
                .put("startTs", session.startTs)
                .put("endTs", session.endTs)
                .put("createdAt", session.createdAt)
            val envelope = encryptPayload(payload.toString())
            eventsJson.put(
                JSONObject()
                    .put("eventId", session.id)
                    .put("sourceDeviceId", settings.deviceId)
                    .put("sourceDeviceType", "mobile")
                    .put("startTs", session.startTs)
                    .put("endTs", session.endTs)
                    .put(
                        "envelope",
                        JSONObject()
                            .put("version", 1)
                            .put("alg", "aes-256-gcm")
                            .put("nonce", envelope.nonce)
                            .put("ciphertext", envelope.ciphertext)
                    )
            )
        }

        val pushBody = JSONObject()
            .put("userId", settings.userId)
            .put("deviceId", settings.deviceId)
            .put("deviceType", "mobile")
            .put("events", eventsJson)

        val pushRequest = Request.Builder()
            .url("${settings.syncServerUrl.trimEnd('/')}/v1/sync/push")
            .post(pushBody.toString().toRequestBody("application/json".toMediaType()))
            .build()
        val pushResponse = client.newCall(pushRequest).execute()
        if (!pushResponse.isSuccessful) error("push failed")

        if (unsynced.isNotEmpty()) {
            dao.markSynced(unsynced.map { it.id })
        }

        val pullRequest = Request.Builder()
            .url(
                "${settings.syncServerUrl.trimEnd('/')}/v1/sync/pull" +
                    "?userId=${settings.userId}" +
                    "&deviceId=${settings.deviceId}" +
                    "&deviceType=mobile" +
                    "&sinceCursor=0&limit=500"
            )
            .get()
            .build()
        val pullResponse = client.newCall(pullRequest).execute()
        if (!pullResponse.isSuccessful) error("pull failed")
        val pullBody = JSONObject(pullResponse.body?.string().orEmpty())
        val events = pullBody.optJSONArray("events") ?: JSONArray()

        val merged = mutableListOf<ActivitySessionEntity>()
        for (index in 0 until events.length()) {
            val event = events.getJSONObject(index)
            val envelopeObj = event.getJSONObject("envelope")
            val envelope = SyncEnvelope(
                nonce = envelopeObj.getString("nonce"),
                ciphertext = envelopeObj.getString("ciphertext")
            )
            val payload = JSONObject(decryptPayload(envelope))
            merged.add(
                ActivitySessionEntity(
                    id = payload.getString("id"),
                    userId = payload.getString("userId"),
                    deviceId = payload.getString("deviceId"),
                    deviceType = payload.getString("deviceType"),
                    source = payload.getString("source"),
                    appName = payload.getString("appName"),
                    windowTitle = payload.getString("windowTitle"),
                    pageUrl = payload.optString("pageUrl"),
                    category = payload.getString("category"),
                    productivity = payload.getString("productivity"),
                    tag = payload.optString("tag"),
                    startTs = payload.getString("startTs"),
                    endTs = payload.getString("endTs"),
                    createdAt = payload.getString("createdAt"),
                    synced = true
                )
            )
        }
        dao.upsertAll(merged)
    }
}
