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
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit

class HealthSyncWorker(appContext: Context, workerParams: WorkerParameters) : CoroutineWorker(appContext, workerParams) {
    override suspend fun doWork(): Result {
        val engine = HealthSyncEngine(applicationContext)
        if (!engine.isPaired()) return Result.success()
        val trigger = inputData.getString("trigger") ?: "background"
        if (HealthConnectClient.getSdkStatus(applicationContext) != HealthConnectClient.SDK_AVAILABLE) {
            engine.reportStatus("failed", trigger, "Health Connect is unavailable.", false)
            return Result.success()
        }
        val client = HealthConnectClient.getOrCreate(applicationContext)
        if (!HealthSyncPermissions.backgroundAvailable(client)) {
            engine.reportStatus("missing_permission", trigger, "This phone does not support background Health Connect reads.", false)
            return Result.success()
        }
        val granted = runCatching { client.permissionController.getGrantedPermissions() }.getOrDefault(emptySet())
        val backgroundGranted = HealthSyncPermissions.requested(client).all { it in granted }
        if (!backgroundGranted) {
            engine.reportStatus("missing_permission", trigger, "Background Health Connect permission is not enabled.", false)
            return Result.success()
        }
        engine.reportStatus("running", trigger, backgroundPermission = true)
        return runCatching { engine.sync(lookbackDays = 2, trigger = trigger, backgroundPermission = true) }
            .fold(
                onSuccess = { Result.success() },
                onFailure = {
                    engine.reportStatus("failed", trigger, it.message, true)
                    Result.retry()
                },
            )
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
            ExistingPeriodicWorkPolicy.KEEP,
            periodic,
        )
    }

    fun syncSoon(context: Context) {
        val immediate = OneTimeWorkRequestBuilder<HealthSyncWorker>()
            .setInputData(workDataOf("trigger" to "app_open"))
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
