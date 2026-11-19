package com.example.zerocast

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.widget.Toast
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString.Companion.toByteString
import java.nio.ByteBuffer
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

class ScreenCaptureService : Service() {

    companion object {
        const val TAG = "ZeroCastCapture"
        const val CHANNEL_ID = "zerocast_capture_channel"
        const val NOTIFICATION_ID = 2001

        const val EXTRA_RESULT_CODE = "extra_result_code"
        const val EXTRA_RESULT_DATA = "extra_result_data"
        const val EXTRA_HOST_IP = "extra_host_ip"
        const val EXTRA_PORT = "extra_port"
        const val EXTRA_ROOM = "extra_room"
        const val EXTRA_DISPLAY_MODE = "extra_display_mode" // "landscape" | "match"

        var isRunning = false
    }

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var mediaCodec: MediaCodec? = null
    private var audioRecord: AudioRecord? = null
    private var webSocket: WebSocket? = null
    private var isCapturing = false
    private var isAudioCapturing = false
    private var displayMode = "landscape"

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null) return START_NOT_STICKY

        val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
        val resultData = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(EXTRA_RESULT_DATA)
        }

        val hostIp = intent.getStringExtra(EXTRA_HOST_IP) ?: "192.168.31.68"
        val port = intent.getStringExtra(EXTRA_PORT) ?: "8080"
        val room = intent.getStringExtra(EXTRA_ROOM) ?: "default-room"
        displayMode = intent.getStringExtra(EXTRA_DISPLAY_MODE) ?: "landscape"

        if (resultData == null || resultCode == 0) {
            stopSelf()
            return START_NOT_STICKY
        }

        startForegroundServiceNotification()

        val mpManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        mediaProjection = mpManager.getMediaProjection(resultCode, resultData)

        // Android 14+ STRICT REQUIREMENT: Must register callback before createVirtualDisplay()
        mediaProjection?.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                super.onStop()
                onDestroy()
            }
        }, Handler(Looper.getMainLooper()))

        connectAndStream(hostIp, port, room)
        isRunning = true

        return START_STICKY
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "ZeroCast Screen Broadcast",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows active status while broadcasting phone screen to PC"
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun startForegroundServiceNotification() {
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("⚡ ZeroCast Active")
            .setContentText("Casting phone screen to laptop in real-time...")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun connectAndStream(hostIp: String, port: String, room: String) {
        val wsUrl = "ws://$hostIp:$port"
        val client = OkHttpClient.Builder()
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .build()

        val request = Request.Builder().url(wsUrl).build()

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: okhttp3.Response) {
                Log.d(TAG, "Connected to ZeroCast WebSocket server for screen broadcasting")
                // Register as phone screen sender
                ws.send("""{"type":"join","room":"$room","role":"phone-sender"}""")
                startScreenEncoder()
                startAudioCapture()
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: okhttp3.Response?) {
                Log.e(TAG, "WebSocket failure: ${t.message}")
            }
        })
    }

    private fun startScreenEncoder() {
        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        wm.defaultDisplay.getRealMetrics(metrics)

        val screenMax = maxOf(metrics.widthPixels, metrics.heightPixels)
        val screenMin = minOf(metrics.widthPixels, metrics.heightPixels)
        var width: Int
        var height: Int

        if (displayMode == "landscape") {
            // Gaming / 16:9 mode for PC: 1920x1080 (or 1280x720)
            // Mirrors landscape games to fill the entire laptop screen without black bars
            if (screenMax >= 1920) {
                width = 1920
                height = 1080
            } else {
                width = 1280
                height = 720
            }
        } else {
            // Match phone orientation
            width = metrics.widthPixels
            height = metrics.heightPixels
            val maxDim = 1920
            if (width > maxDim || height > maxDim) {
                val ratio = width.toFloat() / height.toFloat()
                if (width > height) {
                    width = maxDim
                    height = (maxDim / ratio).toInt()
                } else {
                    height = maxDim
                    width = (maxDim * ratio).toInt()
                }
            }
        }
        // Width and height must be multiples of 16 for hardware encoders
        width = (width / 16) * 16
        height = (height / 16) * 16

        try {
            val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
                setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
                setInteger(MediaFormat.KEY_BIT_RATE, 6_000_000) // 6 Mbps ultra-fast low-latency mobile video
                setInteger(MediaFormat.KEY_FRAME_RATE, 60)
                setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1) // 1 second keyframes
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    setInteger(MediaFormat.KEY_BITRATE_MODE, MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_CBR)
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    setInteger(MediaFormat.KEY_PRIORITY, 0) // Realtime priority
                    setInteger(MediaFormat.KEY_LATENCY, 0) // Zero-latency encoding (no B-frame reordering)
                }
            }

            mediaCodec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC).apply {
                configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            }

            val inputSurface = mediaCodec!!.createInputSurface()
            mediaCodec!!.start()

            virtualDisplay = mediaProjection?.createVirtualDisplay(
                "ZeroCastScreen",
                width, height, metrics.densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                inputSurface, null, null
            )

            // Force immediate keyframe generation
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                val syncParam = Bundle().apply {
                    putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0)
                }
                mediaCodec?.setParameters(syncParam)
            }

            isCapturing = true

            Handler(Looper.getMainLooper()).post {
                Toast.makeText(this@ScreenCaptureService, "⚡ Casting phone screen to laptop!", Toast.LENGTH_SHORT).show()
            }

            // Read encoded H.264 NAL units and stream over WebSocket with SPS/PPS prepended to keyframes
            thread(name = "ZeroCastEncoderThread") {
                val bufferInfo = MediaCodec.BufferInfo()
                var spsPps: ByteArray? = null
                var hasSentKeyframe = false

                while (isCapturing) {
                    val encoder = mediaCodec ?: break
                    val outputIndex = encoder.dequeueOutputBuffer(bufferInfo, 10_000)
                    if (outputIndex >= 0) {
                        val outputBuffer: ByteBuffer? = encoder.getOutputBuffer(outputIndex)
                        if (outputBuffer != null && bufferInfo.size > 0) {
                            outputBuffer.position(bufferInfo.offset)
                            outputBuffer.limit(bufferInfo.offset + bufferInfo.size)

                            val chunk = ByteArray(bufferInfo.size)
                            outputBuffer.get(chunk)

                            val isConfig = (bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0
                            val isKeyFrame = (bufferInfo.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME) != 0

                            if (isConfig) {
                                // Cache SPS/PPS parameter sets
                                spsPps = chunk
                                Log.d(TAG, "Captured SPS/PPS parameter set (${chunk.size} bytes)")
                            } else if (isKeyFrame) {
                                // Prepend SPS/PPS to IDR frame so WebCodecs decodes immediately
                                val fullFrame = if (spsPps != null) {
                                    val combined = ByteArray(spsPps!!.size + chunk.size)
                                    System.arraycopy(spsPps!!, 0, combined, 0, spsPps!!.size)
                                    System.arraycopy(chunk, 0, combined, spsPps!!.size, chunk.size)
                                    combined
                                } else {
                                    chunk
                                }

                                val packet = ByteArray(fullFrame.size + 1)
                                packet[0] = 0x01 // Keyframe marker
                                System.arraycopy(fullFrame, 0, packet, 1, fullFrame.size)
                                webSocket?.send(packet.toByteString())
                                hasSentKeyframe = true
                            } else if (hasSentKeyframe) {
                                // Delta frame
                                val packet = ByteArray(chunk.size + 1)
                                packet[0] = 0x00 // Delta frame marker
                                System.arraycopy(chunk, 0, packet, 1, chunk.size)
                                webSocket?.send(packet.toByteString())
                            }
                        }
                        encoder.releaseOutputBuffer(outputIndex, false)
                    }
                }
            }

        } catch (e: Exception) {
            Log.e(TAG, "Error starting screen encoder: ${e.message}", e)
            Handler(Looper.getMainLooper()).post {
                Toast.makeText(this@ScreenCaptureService, "Cast error: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun startAudioCapture() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || mediaProjection == null) {
            Log.w(TAG, "Internal audio capture requires Android 10+ (API 29+)")
            return
        }

        if (androidx.core.content.ContextCompat.checkSelfPermission(
                this,
                android.Manifest.permission.RECORD_AUDIO
            ) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            Log.w(TAG, "Audio capture skipped: RECORD_AUDIO permission not granted")
            return
        }

        try {
            val config = AudioPlaybackCaptureConfiguration.Builder(mediaProjection!!)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .addMatchingUsage(AudioAttributes.USAGE_GAME)
                .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                .build()

            val sampleRate = 44100
            val channelConfig = AudioFormat.CHANNEL_IN_STEREO
            val audioFormat = AudioFormat.ENCODING_PCM_16BIT
            val minBufSize = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat)
            val bufferSize = maxOf(minBufSize, 4096)

            audioRecord = AudioRecord.Builder()
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(audioFormat)
                        .setSampleRate(sampleRate)
                        .setChannelMask(channelConfig)
                        .build()
                )
                .setAudioPlaybackCaptureConfig(config)
                .setBufferSizeInBytes(bufferSize)
                .build()

            audioRecord?.startRecording()
            isAudioCapturing = true

            thread(name = "ZeroCastAudioThread") {
                val pcmBuffer = ByteArray(2048)
                while (isAudioCapturing) {
                    val read = audioRecord?.read(pcmBuffer, 0, pcmBuffer.size) ?: -1
                    if (read > 0) {
                        // 0x02 header identifies raw 16-bit PCM 44.1kHz Stereo audio
                        val packet = ByteArray(read + 1)
                        packet[0] = 0x02
                        System.arraycopy(pcmBuffer, 0, packet, 1, read)
                        webSocket?.send(packet.toByteString())
                    }
                }
            }
            Log.d(TAG, "AudioPlaybackCapture internal audio streaming active")
        } catch (e: Exception) {
            Log.w(TAG, "AudioPlaybackCapture notice: ${e.message}")
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        isCapturing = false
        isAudioCapturing = false
        isRunning = false
        try {
            audioRecord?.stop()
            audioRecord?.release()
            audioRecord = null
            virtualDisplay?.release()
            mediaCodec?.stop()
            mediaCodec?.release()
            mediaProjection?.stop()
            webSocket?.close(1000, "User stopped")
        } catch (e: Exception) {
            Log.e(TAG, "Cleanup error: ${e.message}")
        }
    }
}
