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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

class MainActivity : ComponentActivity() {
    private val scope = CoroutineScope(SupervisorJob() + kotlinx.coroutines.Dispatchers.Main)
    private lateinit var syncEngine: HealthSyncEngine
    private var healthClient: HealthConnectClient? = null
    private lateinit var codeInput: EditText
    private lateinit var pairingStatus: TextView
    private lateinit var permissionStatus: TextView
    private lateinit var syncStatus: TextView
    private lateinit var requestButton: Button
    private lateinit var syncButton: Button

    private val permissionLauncher = registerForActivityResult(
        PermissionController.createRequestPermissionResultContract()
    ) {
        refreshPermissionStatus()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        syncEngine = HealthSyncEngine(this)
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
            addView(label("Allow nutrition, steps, and weight, plus background read access so syncing can continue automatically. The helper cannot change Health Connect records.", 15f, R.color.muted).withMargins(bottom = 12))
            requestButton = actionButton("Enable automatic sync") { requestPermissions() }
            addView(requestButton)
            addView(secondaryButton("Manage Health Connect access") {
                runCatching { startActivity(Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS)) }
                    .onFailure { startActivity(Intent(Settings.ACTION_SETTINGS)) }
            }.withMargins(top = 8))
            permissionStatus = label("Checking Health Connect…", 14f, R.color.muted).withMargins(top = 10)
            addView(permissionStatus)
        }.withMargins(bottom = 14))

        page.addView(card().apply {
            addView(label("3  Automatic sync", 20f, R.color.ink, true))
            addView(label("Runs about hourly and whenever this helper opens, importing today and the previous 14 days. Website entries you typed manually stay in control.", 15f, R.color.muted).withMargins(bottom = 12))
            syncButton = actionButton("Sync now") { syncNow() }
            addView(syncButton)
            syncStatus = label("Automatic sync has not run yet", 14f, R.color.muted).withMargins(top = 10)
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
        permissionLauncher.launch(HealthSyncPermissions.requested(healthClient ?: return))
    }

    private fun refreshPermissionStatus() {
        val client = healthClient ?: return
        scope.launch {
            val granted = runCatching { client.permissionController.getGrantedPermissions() }.getOrDefault(emptySet())
            val dataReady = granted.containsAll(HealthSyncPermissions.data)
            val backgroundAvailable = HealthSyncPermissions.backgroundAvailable(client)
            val backgroundReady = !backgroundAvailable || HealthSyncPermissions.requested(client).all { it in granted }
            permissionStatus.text = when {
                !dataReady -> "Permission needed for nutrition, steps, and weight"
                !backgroundAvailable -> "Health data is ready, but this phone does not support background Health Connect reads"
                !backgroundReady -> "One-time approval needed for automatic background sync"
                else -> "Automatic sync enabled"
            }
            requestButton.text = if (dataReady && backgroundReady) "Permissions enabled" else "Enable automatic sync"
            if (dataReady && backgroundAvailable && backgroundReady && syncEngine.isPaired()) {
                BackgroundSync.schedule(this@MainActivity)
                BackgroundSync.syncSoon(this@MainActivity)
            }
            refreshSyncStatus()
            refreshButtons()
        }
    }

    private fun refreshPairingStatus() {
        pairingStatus.text = if (syncEngine.isPaired()) "Paired securely" else "Not paired"
        refreshButtons()
    }

    private fun refreshButtons() {
        if (!::requestButton.isInitialized || !::syncButton.isInitialized) return
        requestButton.isEnabled = healthClient != null
        syncButton.isEnabled = healthClient != null && syncEngine.isPaired()
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
                syncEngine.pair(code, android.os.Build.MODEL)
            }.onSuccess {
                codeInput.setText("")
                refreshPairingStatus()
                refreshPermissionStatus()
            }.onFailure { pairingStatus.text = friendlyError(it) }
        }
    }

    private fun syncNow() {
        val client = healthClient ?: return
        if (!syncEngine.isPaired()) return
        syncButton.isEnabled = false
        syncStatus.text = "Reading Health Connect…"
        scope.launch {
            runCatching {
                val granted = client.permissionController.getGrantedPermissions()
                if (!granted.containsAll(HealthSyncPermissions.data)) error("Allow nutrition, steps, and weight first.")
                syncEngine.sync()
            }.onSuccess {
                refreshSyncStatus()
            }.onFailure { syncStatus.text = friendlyError(it) }
            refreshButtons()
        }
    }

    private fun refreshSyncStatus() {
        if (!::syncStatus.isInitialized) return
        val syncedAt = syncEngine.lastSyncAt()
        syncStatus.text = if (syncedAt == null) {
            "Automatic sync has not run yet"
        } else {
            val time = runCatching {
                Instant.parse(syncedAt).atZone(ZoneId.systemDefault())
                    .format(DateTimeFormatter.ofPattern("MMM d 'at' h:mm a", Locale.getDefault()))
            }.getOrDefault("recently")
            "Automatic sync enabled · Last synced $time"
        }
    }

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
