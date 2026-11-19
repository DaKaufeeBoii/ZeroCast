package com.example.zerocast

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.*
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.example.zerocast.ui.theme.ZeroCastTheme

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        enableEdgeToEdge()

        setContent {
            ZeroCastTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = Color(0xFF07090E)
                ) {
                    ZeroCastApp(
                        onToggleImmersive = { enable ->
                            setImmersiveMode(enable)
                        }
                    )
                }
            }
        }
    }

    private fun setImmersiveMode(enable: Boolean) {
        val windowInsetsController = WindowCompat.getInsetsController(window, window.decorView)
        windowInsetsController.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        if (enable) {
            windowInsetsController.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            windowInsetsController.show(WindowInsetsCompat.Type.systemBars())
        }
    }
}

@Composable
fun ZeroCastApp(onToggleImmersive: (Boolean) -> Unit) {
    val context = LocalContext.current
    var connectedUrl by remember { mutableStateOf<String?>(null) }
    var hostIp by remember { mutableStateOf("192.168.31.68") }
    var port by remember { mutableStateOf("8080") }
    var roomCode by remember { mutableStateOf("default-room") }
    var displayMode by remember { mutableStateOf("landscape") }
    var isBroadcastingPhone by remember { mutableStateOf(ScreenCaptureService.isRunning) }

    // Launcher for Android MediaProjection Screen Capture permission
    val screenCaptureLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            val serviceIntent = Intent(context, ScreenCaptureService::class.java).apply {
                putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, result.resultCode)
                putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, result.data)
                putExtra(ScreenCaptureService.EXTRA_HOST_IP, hostIp)
                putExtra(ScreenCaptureService.EXTRA_PORT, "8080") // WebSocket port
                putExtra(ScreenCaptureService.EXTRA_ROOM, roomCode)
                putExtra(ScreenCaptureService.EXTRA_DISPLAY_MODE, displayMode)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }
            isBroadcastingPhone = true
        }
    }

    // Launcher for Audio Recording Permission (Required for internal game audio streaming)
    val recordAudioLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { _ ->
        val mpManager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        screenCaptureLauncher.launch(mpManager.createScreenCaptureIntent())
    }

    if (connectedUrl != null) {
        BackHandler {
            onToggleImmersive(false)
            connectedUrl = null
        }

        onToggleImmersive(true)

        Box(modifier = Modifier.fillMaxSize()) {
            ZeroCastViewer(
                url = connectedUrl!!,
                modifier = Modifier.fillMaxSize()
            )

            // Floating Disconnect Button
            Button(
                onClick = {
                    onToggleImmersive(false)
                    connectedUrl = null
                },
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xCC151B27)),
                shape = RoundedCornerShape(20.dp),
                modifier = Modifier
                    .padding(top = 16.dp, start = 16.dp)
                    .align(Alignment.TopStart)
            ) {
                Text("✕ Exit Fullscreen", color = Color(0xFF00F0FF), fontSize = 12.sp, fontWeight = FontWeight.Bold)
            }
        }
    } else {
        onToggleImmersive(false)
        HomeScreen(
            hostIp = hostIp,
            onHostIpChange = { hostIp = it },
            port = port,
            onPortChange = { port = it },
            roomCode = roomCode,
            onRoomCodeChange = { roomCode = it },
            displayMode = displayMode,
            onDisplayModeChange = { displayMode = it },
            isBroadcastingPhone = isBroadcastingPhone,
            onWatchLaptop = {
                connectedUrl = "http://$hostIp:$port/?room=$roomCode&mode=receiver"
            },
            onSharePhone = {
                if (isBroadcastingPhone) {
                    // Stop service
                    context.stopService(Intent(context, ScreenCaptureService::class.java))
                    isBroadcastingPhone = false
                } else {
                    val hasAudioPermission = androidx.core.content.ContextCompat.checkSelfPermission(
                        context,
                        android.Manifest.permission.RECORD_AUDIO
                    ) == android.content.pm.PackageManager.PERMISSION_GRANTED

                    if (hasAudioPermission) {
                        val mpManager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
                        screenCaptureLauncher.launch(mpManager.createScreenCaptureIntent())
                    } else {
                        recordAudioLauncher.launch(android.Manifest.permission.RECORD_AUDIO)
                    }
                }
            }
        )
    }
}

@Composable
fun HomeScreen(
  hostIp: String,
  onHostIpChange: (String) -> Unit,
  port: String,
  onPortChange: (String) -> Unit,
  roomCode: String,
  onRoomCodeChange: (String) -> Unit,
  displayMode: String,
  onDisplayModeChange: (String) -> Unit,
  isBroadcastingPhone: Boolean,
  onWatchLaptop: () -> Unit,
  onSharePhone: () -> Unit
) {
    val cyan = Color(0xFF00F0FF)
    val darkCard = Color(0xFF151B27)
    val textMuted = Color(0xFF8D9BB0)
    val green = Color(0xFF10B981)
    val red = Color(0xFFEF4444)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(modifier = Modifier.height(20.dp))

        // Title
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("⚡", fontSize = 34.sp)
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = "ZeroCast",
                fontSize = 30.sp,
                fontWeight = FontWeight.ExtraBold,
                color = Color.White
            )
        }

        Text(
            text = "Wireless Display & Screen Mirroring",
            fontSize = 14.sp,
            color = cyan,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.padding(top = 4.dp, bottom = 24.dp)
        )

        // HOST CONNECTION CARD
        Card(
            colors = CardDefaults.cardColors(containerColor = darkCard),
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(modifier = Modifier.padding(18.dp)) {
                Text("CONNECTION SETTINGS", fontSize = 11.sp, color = textMuted, fontWeight = FontWeight.Bold)
                Spacer(modifier = Modifier.height(10.dp))

                OutlinedTextField(
                    value = hostIp,
                    onValueChange = onHostIpChange,
                    label = { Text("PC / Laptop IP Address") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = cyan,
                        unfocusedBorderColor = Color(0xFF252F44),
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White
                    )
                )

                Spacer(modifier = Modifier.height(10.dp))

                Row(modifier = Modifier.fillMaxWidth()) {
                    OutlinedTextField(
                        value = port,
                        onValueChange = onPortChange,
                        label = { Text("Port") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = cyan,
                            unfocusedBorderColor = Color(0xFF252F44),
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color.White
                        )
                    )

                    Spacer(modifier = Modifier.width(10.dp))

                    OutlinedTextField(
                        value = roomCode,
                        onValueChange = onRoomCodeChange,
                        label = { Text("Room Code") },
                        singleLine = true,
                        modifier = Modifier.weight(1.5f),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = cyan,
                            unfocusedBorderColor = Color(0xFF252F44),
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color.White
                        )
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(20.dp))

        Text("CHOOSE CAST DIRECTION", fontSize = 11.sp, color = textMuted, fontWeight = FontWeight.Bold, modifier = Modifier.align(Alignment.Start))
        Spacer(modifier = Modifier.height(10.dp))

        // OPTION 1: WATCH LAPTOP SCREEN
        Card(
            colors = CardDefaults.cardColors(containerColor = darkCard),
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, Color(0xFF252F44), RoundedCornerShape(16.dp))
        ) {
            Column(modifier = Modifier.padding(18.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("📺", fontSize = 24.sp)
                    Spacer(modifier = Modifier.width(10.dp))
                    Column {
                        Text("Watch Laptop Screen", color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                        Text("Turn this phone into a wireless monitor for PC", color = textMuted, fontSize = 12.sp)
                    }
                }
                Spacer(modifier = Modifier.height(14.dp))

                Button(
                    onClick = onWatchLaptop,
                    colors = ButtonDefaults.buttonColors(containerColor = cyan),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth().height(46.dp)
                ) {
                    Text("Watch Laptop Screen ➔", color = Color.Black, fontWeight = FontWeight.ExtraBold, fontSize = 14.sp)
                }
            }
        }

        Spacer(modifier = Modifier.height(14.dp))

        // OPTION 2: SHARE PHONE SCREEN TO PC
        Card(
            colors = CardDefaults.cardColors(containerColor = darkCard),
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier
                .fillMaxWidth()
                .border(
                    1.dp,
                    if (isBroadcastingPhone) green else Color(0xFF252F44),
                    RoundedCornerShape(16.dp)
                )
        ) {
            Column(modifier = Modifier.padding(18.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("📱", fontSize = 24.sp)
                    Spacer(modifier = Modifier.width(10.dp))
                    Column {
                        Text(
                            if (isBroadcastingPhone) "● LIVE BROADCASTING ACTIVE" else "Cast Phone Screen to Laptop",
                            color = if (isBroadcastingPhone) green else Color.White,
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            if (isBroadcastingPhone) "Streaming phone display to PC in real-time" else "Broadcast this phone's screen live to PC",
                            color = textMuted,
                            fontSize = 12.sp
                        )
                    }
                }
                Spacer(modifier = Modifier.height(14.dp))

                // Display Mode Selection
                Text("STREAM ASPECT & RESOLUTION", fontSize = 10.sp, color = textMuted, fontWeight = FontWeight.Bold)
                Spacer(modifier = Modifier.height(6.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = displayMode == "landscape",
                        onClick = { onDisplayModeChange("landscape") },
                        label = { Text("🎮 Gaming (16:9 PC)", fontSize = 12.sp) },
                        modifier = Modifier.weight(1f),
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = Color(0xFF1E3A8A),
                            selectedLabelColor = Color(0xFF93C5FD)
                        )
                    )
                    FilterChip(
                        selected = displayMode == "match",
                        onClick = { onDisplayModeChange("match") },
                        label = { Text("📱 Match Phone", fontSize = 12.sp) },
                        modifier = Modifier.weight(1f),
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = Color(0xFF1E3A8A),
                            selectedLabelColor = Color(0xFF93C5FD)
                        )
                    )
                }
                Spacer(modifier = Modifier.height(14.dp))

                Button(
                    onClick = onSharePhone,
                    colors = ButtonDefaults.buttonColors(containerColor = if (isBroadcastingPhone) red else Color(0xFF3B82F6)),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth().height(46.dp)
                ) {
                    Text(
                        if (isBroadcastingPhone) "⏹ Stop Casting Phone Screen" else "📱 Start Casting Phone Screen",
                        color = Color.White,
                        fontWeight = FontWeight.ExtraBold,
                        fontSize = 14.sp
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(24.dp))

        Text(
            text = "⚡ Sub-25ms latency • Hardware H.264 • Fullscreen Immersion",
            color = textMuted,
            fontSize = 12.sp
        )
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ZeroCastViewer(url: String, modifier: Modifier = Modifier) {
    AndroidView(
        modifier = modifier,
        factory = { context ->
            WebView(context).apply {
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
                setBackgroundColor(android.graphics.Color.BLACK)

                settings.apply {
                    javaScriptEnabled = true
                    domStorageEnabled = true
                    mediaPlaybackRequiresUserGesture = false
                    allowFileAccess = true
                    useWideViewPort = true
                    loadWithOverviewMode = true
                    setSupportZoom(false)
                    mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                }

                webChromeClient = object : WebChromeClient() {
                    override fun onPermissionRequest(request: PermissionRequest) {
                        request.grant(request.resources)
                    }
                }

                webViewClient = object : WebViewClient() {
                    override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
                        handler?.proceed()
                    }
                }

                loadUrl(url)
            }
        },
        update = { webView ->
            if (webView.url != url) {
                webView.loadUrl(url)
            }
        }
    )
}
