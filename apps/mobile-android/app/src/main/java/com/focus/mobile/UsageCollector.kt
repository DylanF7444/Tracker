package com.focus.mobile

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import java.time.Instant
import java.util.UUID

class UsageCollector(
    private val context: Context,
    private val settings: FocusSettings
) {
    fun collectRecentSessions(): List<ActivitySessionEntity> {
        val manager = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val end = System.currentTimeMillis()
        val start = end - (15 * 60 * 1000)
        val events = manager.queryEvents(start, end)
        val result = mutableListOf<ActivitySessionEntity>()

        val event = UsageEvents.Event()
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            when (event.eventType) {
                UsageEvents.Event.ACTIVITY_RESUMED -> {
                    result.add(
                        ActivitySessionEntity(
                            id = UUID.randomUUID().toString(),
                            userId = settings.userId,
                            deviceId = settings.deviceId,
                            source = "mobile-usage",
                            appName = event.packageName ?: "Unknown",
                            windowTitle = event.className ?: event.packageName ?: "Unknown",
                            category = classify(event.packageName ?: ""),
                            productivity = productivity(event.packageName ?: ""),
                            tag = "",
                            startTs = Instant.ofEpochMilli(event.timeStamp).toString(),
                            endTs = Instant.ofEpochMilli(event.timeStamp + 60_000).toString(),
                            createdAt = Instant.now().toString()
                        )
                    )
                }

                UsageEvents.Event.KEYGUARD_HIDDEN -> {
                    val ts = Instant.ofEpochMilli(event.timeStamp).toString()
                    result.add(
                        ActivitySessionEntity(
                            id = UUID.randomUUID().toString(),
                            userId = settings.userId,
                            deviceId = settings.deviceId,
                            source = "mobile-usage",
                            appName = "Unlock Event",
                            windowTitle = "Device unlock",
                            category = "system",
                            productivity = "neutral",
                            tag = "pickup",
                            startTs = ts,
                            endTs = ts,
                            createdAt = Instant.now().toString()
                        )
                    )
                }
            }
        }
        return result
    }

    private fun classify(packageName: String): String = when {
        packageName.contains("youtube", ignoreCase = true) -> "entertainment"
        packageName.contains("slack", ignoreCase = true) -> "communication"
        else -> "neutral"
    }

    private fun productivity(packageName: String): String = when {
        packageName.contains("youtube", ignoreCase = true) -> "distracting"
        packageName.contains("github", ignoreCase = true) -> "productive"
        else -> "neutral"
    }
}
