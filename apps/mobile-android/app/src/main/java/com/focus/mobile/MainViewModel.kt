package com.focus.mobile

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.UUID

data class UiState(
    val sessions: List<ActivitySessionEntity> = emptyList(),
    val syncStatus: String = "Idle"
)

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val settings = FocusSettings()
    private val db = FocusDatabase.get(application)
    private val dao = db.sessionDao()
    private val usageCollector = UsageCollector(application, settings)
    private val syncRepository = SyncRepository(dao, settings)

    private val _uiState = MutableStateFlow(UiState())
    val uiState: StateFlow<UiState> = _uiState

    init {
        refreshSessions()
    }

    fun refreshSessions() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(sessions = dao.listSessions())
        }
    }

    fun collectUsage() {
        viewModelScope.launch {
            usageCollector.collectRecentSessions().forEach { dao.upsert(it) }
            refreshSessions()
        }
    }

    fun addManualTag(tag: String) {
        viewModelScope.launch {
            val end = Instant.now()
            val start = end.minusSeconds(25 * 60)
            dao.upsert(
                ActivitySessionEntity(
                    id = UUID.randomUUID().toString(),
                    userId = settings.userId,
                    deviceId = settings.deviceId,
                    source = "manual-tag",
                    appName = tag,
                    windowTitle = tag,
                    category = if (tag == "deep work") "productivity" else "break",
                    productivity = if (tag == "deep work") "productive" else "neutral",
                    tag = tag,
                    startTs = start.toString(),
                    endTs = end.toString(),
                    createdAt = end.toString()
                )
            )
            refreshSessions()
        }
    }

    fun syncNow() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(syncStatus = "Syncing...")
            try {
                syncRepository.syncNow()
                _uiState.value = _uiState.value.copy(syncStatus = "All devices synced")
                refreshSessions()
            } catch (_: Throwable) {
                _uiState.value = _uiState.value.copy(syncStatus = "Phone offline")
            }
        }
    }
}
