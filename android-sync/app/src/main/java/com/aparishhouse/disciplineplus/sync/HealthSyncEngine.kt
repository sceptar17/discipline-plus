package com.aparishhouse.disciplineplus.sync

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.aggregate.AggregationResult
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.NutritionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.records.metadata.DataOrigin
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

object HealthSyncPermissions {
    val data = setOf(
        HealthPermission.getReadPermission(NutritionRecord::class),
        HealthPermission.getReadPermission(StepsRecord::class),
        HealthPermission.getReadPermission(WeightRecord::class),
    )

    fun backgroundAvailable(client: HealthConnectClient): Boolean =
        client.features.getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND) ==
            HealthConnectFeatures.FEATURE_STATUS_AVAILABLE

    fun requested(client: HealthConnectClient): Set<String> = if (backgroundAvailable(client)) {
        data + HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND
    } else {
        data
    }
}

class HealthSyncEngine(context: Context) {
    private val appContext = context.applicationContext
    private val tokenStore = SecureTokenStore(appContext)
    private val state = appContext.getSharedPreferences("sync_state", Context.MODE_PRIVATE)
    private val syncBaseUrl = "https://discipline-plus-sync.bfust27.workers.dev"

    fun isPaired() = tokenStore.read() != null
    fun lastSyncAt(): String? = state.getString("last_sync_at", null)

    suspend fun pair(code: String, deviceName: String) {
        val response = postJson(
            "$syncBaseUrl/pair",
            JSONObject().put("code", code).put("name", deviceName),
        )
        tokenStore.save(response.getString("token"))
    }

    suspend fun sync(lookbackDays: Int = 14, trigger: String = "manual", backgroundPermission: Boolean? = null): String {
        val token = tokenStore.read() ?: error("Pair this phone first.")
        if (HealthConnectClient.getSdkStatus(appContext) != HealthConnectClient.SDK_AVAILABLE) {
            error("Health Connect is unavailable.")
        }
        val client = HealthConnectClient.getOrCreate(appContext)
        val zone = ZoneId.systemDefault()
        val days = JSONArray()
        for (offset in lookbackDays.coerceIn(0, 14) downTo 0) {
            days.put(readDay(client, LocalDate.now(zone).minusDays(offset.toLong()), zone))
        }
        val response = postJson(
            "$syncBaseUrl/sync",
            JSONObject()
                .put("timezone", zone.id)
                .put("days", days)
                .put("trigger", trigger)
                .put("appVersion", BuildConfig.VERSION_NAME)
                .putNullable("backgroundPermission", backgroundPermission),
            token,
        )
        val syncedAt = response.optString("syncedAt").takeIf { it.isNotBlank() } ?: Instant.now().toString()
        state.edit().putString("last_sync_at", syncedAt).apply()
        return syncedAt
    }

    suspend fun reportStatus(status: String, trigger: String, error: String? = null, backgroundPermission: Boolean? = null) {
        val token = tokenStore.read() ?: return
        runCatching {
            postJson(
                "$syncBaseUrl/status",
                JSONObject()
                    .put("status", status)
                    .put("trigger", trigger)
                    .put("appVersion", BuildConfig.VERSION_NAME)
                    .putNullable("error", error?.take(300))
                    .putNullable("backgroundPermission", backgroundPermission),
                token,
            )
        }
    }

    private suspend fun readDay(client: HealthConnectClient, date: LocalDate, zone: ZoneId): JSONObject {
        val start = date.atStartOfDay(zone).toInstant()
        val end = date.plusDays(1).atStartOfDay(zone).toInstant()
        val range = TimeRangeFilter.between(start, end)
        val nutrition: AggregationResult = client.aggregate(
            AggregateRequest(
                metrics = setOf(
                    NutritionRecord.ENERGY_TOTAL,
                    NutritionRecord.PROTEIN_TOTAL,
                    NutritionRecord.TOTAL_CARBOHYDRATE_TOTAL,
                    NutritionRecord.TOTAL_FAT_TOTAL,
                ),
                timeRangeFilter = range,
                dataOriginFilter = setOf(DataOrigin("com.sbs.diet")),
            )
        )
        val stepResult = client.aggregate(
            AggregateRequest(metrics = setOf(StepsRecord.COUNT_TOTAL), timeRangeFilter = range)
        )
        val latestWeight = client.readRecords(
            ReadRecordsRequest(recordType = WeightRecord::class, timeRangeFilter = range)
        ).records.maxByOrNull { it.time }
        val nutritionJson = JSONObject()
            .putNullable("caloriesKcal", nutrition[NutritionRecord.ENERGY_TOTAL]?.inKilocalories)
            .putNullable("proteinG", nutrition[NutritionRecord.PROTEIN_TOTAL]?.inGrams)
            .putNullable("carbsG", nutrition[NutritionRecord.TOTAL_CARBOHYDRATE_TOTAL]?.inGrams)
            .putNullable("fatG", nutrition[NutritionRecord.TOTAL_FAT_TOTAL]?.inGrams)
            .put("sourcePackage", "com.sbs.diet")
        return JSONObject()
            .put("date", date.toString())
            .put("nutrition", nutritionJson)
            .putNullable("steps", stepResult[StepsRecord.COUNT_TOTAL])
            .apply {
                if (latestWeight != null) {
                    put("weight", JSONObject()
                        .put("pounds", latestWeight.weight.inPounds)
                        .put("measuredAt", latestWeight.time.toString())
                        .put("recordId", latestWeight.metadata.id)
                        .put("sourcePackage", latestWeight.metadata.dataOrigin.packageName))
                }
            }
    }

    private suspend fun postJson(url: String, body: JSONObject, token: String? = null): JSONObject = withContext(Dispatchers.IO) {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.setRequestProperty("Accept", "application/json")
            if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
            connection.outputStream.use { it.write(body.toString().toByteArray()) }
            val success = connection.responseCode in 200..299
            val text = (if (success) connection.inputStream else connection.errorStream)
                ?.bufferedReader()?.use { it.readText() }.orEmpty()
            val payload = if (text.isBlank()) JSONObject() else JSONObject(text)
            if (!success) error(payload.optString("error", "Sync request failed."))
            payload
        } finally {
            connection.disconnect()
        }
    }

    private fun JSONObject.putNullable(name: String, value: Any?): JSONObject = put(name, value ?: JSONObject.NULL)
}
