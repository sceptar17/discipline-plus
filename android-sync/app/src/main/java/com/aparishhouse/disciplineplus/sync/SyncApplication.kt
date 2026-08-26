package com.aparishhouse.disciplineplus.sync

import android.app.Application

class SyncApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        if (HealthSyncEngine(this).isPaired()) BackgroundSync.schedule(this)
    }
}
