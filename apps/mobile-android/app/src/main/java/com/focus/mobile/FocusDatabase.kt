package com.focus.mobile

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase

@Dao
interface SessionDao {
    @Query("SELECT * FROM sessions ORDER BY startTs DESC")
    suspend fun listSessions(): List<ActivitySessionEntity>

    @Query("SELECT * FROM sessions WHERE synced = 0")
    suspend fun unsyncedSessions(): List<ActivitySessionEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(session: ActivitySessionEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(sessions: List<ActivitySessionEntity>)

    @Query("UPDATE sessions SET synced = 1 WHERE id IN (:ids)")
    suspend fun markSynced(ids: List<String>)
}

@Database(entities = [ActivitySessionEntity::class], version = 1, exportSchema = false)
abstract class FocusDatabase : RoomDatabase() {
    abstract fun sessionDao(): SessionDao

    companion object {
        @Volatile
        private var instance: FocusDatabase? = null

        fun get(context: Context): FocusDatabase {
            return instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context,
                    FocusDatabase::class.java,
                    "focus-mobile.db"
                ).build().also { instance = it }
            }
        }
    }
}
