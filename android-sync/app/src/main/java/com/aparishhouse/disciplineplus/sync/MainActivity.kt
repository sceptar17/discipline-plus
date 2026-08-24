package com.aparishhouse.disciplineplus.sync

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.aggregate.AggregationResult
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.NutritionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.records.metadata.DataOrigin
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

class MainActivity : ComponentActivity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val syncBaseUrl = "https://discipline-plus-sync.bfust27.workers.dev"
    private val permissions = setOf(
        HealthPermission.getReadPermission(NutritionRecord::class),
        HealthPermission.getReadPermission(StepsRecord::class),
        HealthPermission.getReadPermission(WeightRecord::class),
    )
    private lateinit var tokenStore: SecureTokenStore
    private var healthClient: HealthConnectClient? = null
    private lateinit var codeInput: EditText
    private lateinit var pairingStatus: TextView
    private lateinit var permissionStatus: TextView
    private lateinit var syncStatus: TextView
    private lateinit var requestButton: Button
    private lateinit var syncButton: Button

    private val permissionLauncher = registerForActivityResult(
        PermissionController.createRequestPermissionResultContract()
    ) { granted ->
        permissionStatus.text = if (granted.containsAll(permissions)) {
            "Ready — nutrition, steps, and weight allowed"
        } else {
            "Some access is still missing"
        }
        refreshButtons()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        tokenStore = SecureTokenStore(this)
        buildScreen()
        initializeHealthConnect()
        refreshPairingStatus()
    }

    override fun onResume() {
        super.onResume()
        refreshPermissionStatus()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun buildScreen() {
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(24), dp(22), dp(40))
            setBackgroundColor(getColor(R.color.background))
        }
        page.addView(label("DISCIPLINE+", 13f, R.color.accent, true))
        page.addView(label("Health Connect sync", 29f, R.color.ink, true).withMargins(bottom = 6))
        page.addView(label("A small companion that brings MacroFactor, Pixel Watch, and phone data into your fitness app.", 16f, R.color.muted).withMargins(bottom = 22))

        page.addView(card().apply {
            addView(label("1  Pair this phone", 20f, R.color.ink, true))
            addView(label("In the website, open Settings → Integrations → Pair Android phone. Enter the one-time code here.", 15f, R.color.muted).withMargins(bottom = 12))
            codeInput = EditText(this@MainActivity).apply {
                hint = "XXXX-XXXX-XXXX"
                textSize = 20f
                gravity = Gravity.CENTER
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
                isSingleLine = true
                letterSpacing = 0.08f
                setPadding(dp(12), dp(12), dp(12), dp(12))
            }
            addView(codeInput, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            addView(actionButton("Pair phone") { pairPhone() }.withMargins(top = 10))
            pairingStatus = label("Not paired", 14f, R.color.muted).withMargins(top = 10)
            addView(pairingStatus)
        }.withMargins(bottom = 14))

        page.addView(card().apply {
            addView(label("2  Allow Health Connect", 20f, R.color.ink, true))
            addView(label("The app only asks to read nutrition, steps, and weight. It cannot change your Health Connect records.", 15f, R.color.muted).withMargins(bottom = 12))
            requestButton = actionButton("Review permissions") { requestPermissions() }
            addView(requestButton)
            addView(secondaryButton("Manage Health Connect access") {
                runCatching { startActivity(Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS)) }
                    .onFailure { startActivity(Intent(Settings.ACTION_SETTINGS)) }
            }.withMargins(top = 8))
            permissionStatus = label("Checking Health Connect…", 14f, R.color.muted).withMargins(top = 10)
            addView(permissionStatus)
        }.withMargins(bottom = 14))

        page.addView(card().apply {
            addView(label("3  Sync", 20f, R.color.ink, true))
            addView(label("Imports today and the previous 14 days. Website entries you typed manually stay in control.", 15f, R.color.muted).withMargins(bottom = 12))
            syncButton = actionButton("Sync now") { syncNow() }
            addView(syncButton)
            syncStatus = label("Nothing synced yet", 14f, R.color.muted).withMargins(top = 10)
            addView(syncStatus)
        })

        setContentView(ScrollView(this).apply { addView(page) })
    }

    private fun initializeHealthConnect() {
        when (HealthConnectClient.getSdkStatus(this)) {
            HealthConnectClient.SDK_AVAILABLE -> healthClient = HealthConnectClient.getOrCreate(this)
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> permissionStatus.text = "Health Connect needs to be installed or updated"
            else -> permissionStatus.text = "Health Connect is unavailable on this phone"
        }
        refreshButtons()
    }

    private fun requestPermissions() {
        if (healthClient == null) {
            initializeHealthConnect()
            return
        }
        permissionLauncher.launch(permissions)
    }

    private fun refreshPermissionStatus() {
        val client = healthClient ?: return
        scope.launch {
            val granted = runCatching { client.permissionController.getGrantedPermissions() }.getOrDefault(emptySet())
            permissionStatus.text = if (granted.containsAll(permissions)) {
                "Ready — nutrition, steps, and weight allowed"
            } else {
                "Permission needed for nutrition, steps, and weight"
            }
            refreshButtons()
        }
    }

    private fun refreshPairingStatus() {
        pairingStatus.text = if (tokenStore.read() == null) "Not paired" else "Paired securely"
        refreshButtons()
    }

    private fun refreshButtons() {
        if (!::requestButton.isInitialized || !::syncButton.isInitialized) return
        requestButton.isEnabled = healthClient != null
        syncButton.isEnabled = healthClient != null && tokenStore.read() != null
    }

    private fun pairPhone() {
        val code = codeInput.text.toString().trim()
        if (code.isBlank()) {
            pairingStatus.text = "Enter the code shown on the website"
            return
        }
        pairingStatus.text = "Pairing…"
        scope.launch {
            runCatching {
                val response = postJson("$syncBaseUrl/pair", JSONObject().put("code", code).put("name", android.os.Build.MODEL))
                tokenStore.save(response.getString("token"))
            }.onSuccess {
                codeInput.setText("")
                refreshPairingStatus()
            }.onFailure { pairingStatus.text = friendlyError(it) }
        }
    }

    private fun syncNow() {
        val client = healthClient ?: return
        val token = tokenStore.read() ?: return
        syncButton.isEnabled = false
        syncStatus.text = "Reading Health Connect…"
        scope.launch {
            runCatching {
                val granted = client.permissionController.getGrantedPermissions()
                if (!granted.containsAll(permissions)) error("Allow all three Health Connect permissions first.")
                val zone = ZoneId.systemDefault()
                val days = JSONArray()
                for (offset in 14 downTo 0) {
                    days.put(readDay(client, LocalDate.now(zone).minusDays(offset.toLong()), zone))
                }
                syncStatus.text = "Saving 15 days…"
                postJson("$syncBaseUrl/sync", JSONObject().put("timezone", zone.id).put("days", days), token)
            }.onSuccess {
                val time = java.time.LocalTime.now().format(DateTimeFormatter.ofPattern("h:mm a", Locale.getDefault()))
                syncStatus.text = "Synced through today at $time"
            }.onFailure { syncStatus.text = friendlyError(it) }
            refreshButtons()
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
        val weights = client.readRecords(
            ReadRecordsRequest(recordType = WeightRecord::class, timeRangeFilter = range)
        ).records
        val latestWeight = weights.maxByOrNull { it.time }
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
            val text = (if (success) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            val payload = if (text.isBlank()) JSONObject() else JSONObject(text)
            if (!success) error(payload.optString("error", "Sync request failed."))
            payload
        } finally {
            connection.disconnect()
        }
    }

    private fun JSONObject.putNullable(name: String, value: Any?): JSONObject = put(name, value ?: JSONObject.NULL)
    private fun friendlyError(error: Throwable) = error.message?.takeIf { it.isNotBlank() } ?: "Something went wrong. Try again."
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private fun card() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(18), dp(18), dp(18), dp(18))
        setBackgroundColor(getColor(R.color.surface))
        elevation = dp(1).toFloat()
    }

    private fun label(text: String, size: Float, color: Int, bold: Boolean = false) = TextView(this).apply {
        this.text = text
        textSize = size
        setTextColor(getColor(color))
        if (bold) setTypeface(typeface, Typeface.BOLD)
        setLineSpacing(0f, 1.12f)
    }

    private fun actionButton(text: String, action: () -> Unit) = Button(this).apply {
        this.text = text
        isAllCaps = false
        textSize = 16f
        setTextColor(Color.WHITE)
        setBackgroundColor(getColor(R.color.accent))
        setOnClickListener { action() }
    }

    private fun secondaryButton(text: String, action: () -> Unit) = Button(this).apply {
        this.text = text
        isAllCaps = false
        textSize = 15f
        setTextColor(getColor(R.color.ink))
        setBackgroundColor(getColor(R.color.background))
        setOnClickListener { action() }
    }

    private fun <T : View> T.withMargins(top: Int = 0, bottom: Int = 0): T {
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(top)
            bottomMargin = dp(bottom)
        }
        return this
    }
}
