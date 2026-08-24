package com.aparishhouse.disciplineplus.sync

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

class HealthSyncWorker(appContext: Context, workerParams: WorkerParameters) : CoroutineWorker(appContext, workerParams) {
    override suspend fun doWork(): Result {
        if (HealthConnectClient.getSdkStatus(applicationContext) != HealthConnectClient.SDK_AVAILABLE) return Result.success()
        val client = HealthConnectClient.getOrCreate(applicationContext)
        if (!HealthSyncPermissions.backgroundAvailable(client)) return Result.success()
        val granted = runCatching { client.permissionController.getGrantedPermissions() }.getOrDefault(emptySet())
        if (!granted.containsAll(HealthSyncPermissions.requested(client))) return Result.success()
        if (!HealthSyncEngine(applicationContext).isPaired()) return Result.success()
        return runCatching { HealthSyncEngine(applicationContext).sync(lookbackDays = 2) }
            .fold(onSuccess = { Result.success() }, onFailure = { Result.retry() })
    }
}

object BackgroundSync {
    private const val PERIODIC_WORK = "discipline_plus_health_sync"
    private const val IMMEDIATE_WORK = "discipline_plus_health_sync_now"

    private val networkConstraint = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()

    fun schedule(context: Context) {
        val periodic = PeriodicWorkRequestBuilder<HealthSyncWorker>(1, TimeUnit.HOURS)
            .setConstraints(networkConstraint)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.MINUTES)
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            PERIODIC_WORK,
            ExistingPeriodicWorkPolicy.UPDATE,
            periodic,
        )
    }

    fun syncSoon(context: Context) {
        val immediate = OneTimeWorkRequestBuilder<HealthSyncWorker>()
            .setConstraints(networkConstraint)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.MINUTES)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            IMMEDIATE_WORK,
            ExistingWorkPolicy.REPLACE,
            immediate,
        )
    }
}
