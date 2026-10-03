package kr.mirror

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.Icon
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.util.DisplayMetrics
import android.view.Display
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import kotlin.math.abs
import kotlin.math.min

class ScreenStreamService : Service() {

    companion object {
        const val ACTION_STOP = "kr.mirror.STOP"
        const val EXTRA_CODE = "code"
        const val EXTRA_DATA = "data"
        const val EXTRA_MODE = "mode"
        const val EXTRA_TARGET = "target"

        @Volatile var running = false
        @Volatile var port = 0
        @Volatile var ip: String? = null

        private const val CHANNEL = "mirror"
        private const val NID = 1
        private const val MAX_LONG_SIDE = 1920      // FHD 기준(긴 변), 화면비 유지
        private const val MIN_INTERVAL_MS = 1000L / 24  // 최대 24fps
        private const val JPEG_QUALITY = 70
    }

    private lateinit var prefs: Prefs
    private val main = Handler(Looper.getMainLooper())
    private lateinit var capThread: HandlerThread
    private lateinit var cap: Handler

    private var mp: MediaProjection? = null
    private var mpCallback: MediaProjection.Callback? = null
    private var vd: VirtualDisplay? = null
    @Volatile private var reader: ImageReader? = null
    private var server: StreamServer? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var displayListener: DisplayManager.DisplayListener? = null

    private var mode = "full"
    private var target = ""
    private var capW = 0
    private var capH = 0
    private var dpi = 0

    // ---- 재사용 버퍼 (프레임마다 새로 만들지 않음) ----
    private var bitmap: Bitmap? = null
    private var rowBuf: ByteBuffer? = null
    private val jpegOut = ByteArrayOutputStream(512 * 1024)

    // ---- 가변 프레임 / 제한 ----
    private var lastEncode = 0L
    private var trailingScheduled = false
    @Volatile private var frozen = false
    private var held: Image? = null

    // ---- 한 앱 고정용 ----
    private var currentFg: String? = null
    private var lastEventQuery = 0L

    // ---- 오버레이 ----
    private var wm: WindowManager? = null
    private var dot: View? = null
    private var dotLp: WindowManager.LayoutParams? = null
    private var confirmView: View? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (intent == null || running) {
            if (intent == null) stopSelf()
            return START_NOT_STICKY
        }
        prefs = Prefs(this)
        createChannel()
        val n = buildNotif("시작하는 중…")
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(NID, n)
        }

        mode = intent.getStringExtra(EXTRA_MODE) ?: "full"
        target = intent.getStringExtra(EXTRA_TARGET) ?: ""
        val code = intent.getIntExtra(EXTRA_CODE, 0)
        @Suppress("DEPRECATION")
        val data = intent.getParcelableExtra<Intent>(EXTRA_DATA)
        if (data == null) {
            stopSelf()
            return START_NOT_STICKY
        }

        // 서버 시작(포트 충돌 시 자동으로 다음 포트)
        val srv = StreamServer({ statusJson() }, { main.post { stopSelf() } })
        try {
            port = srv.start()
        } catch (e: Exception) {
            Toast.makeText(this, "서버를 시작할 수 없습니다", Toast.LENGTH_LONG).show()
            stopSelf()
            return START_NOT_STICKY
        }
        server = srv

        capThread = HandlerThread("capture").also { it.start() }
        cap = Handler(capThread.looper)

        val mpm = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val proj = try {
            mpm.getMediaProjection(code, data)
        } catch (e: Exception) {
            null
        }
        if (proj == null) {
            srv.stop()
            stopSelf()
            return START_NOT_STICKY
        }
        mp = proj
        // 안드로이드 14+: createVirtualDisplay 전에 콜백 등록 필수
        mpCallback = object : MediaProjection.Callback() {
            override fun onStop() {
                main.post { stopSelf() }
            }
        }
        proj.registerCallback(mpCallback!!, main)

        running = true
        ip = Net.findIp()
        acquireWifiLock()
        setupCapture()
        showOverlay()
        updateNotif()
        reportAsync(true)

        main.postDelayed(ipPoll, 15_000)
        main.postDelayed(heartbeat, 30 * 60 * 1000L)
        if (mode == "app") {
            frozen = true
            cap.post(fgPoll)
        }
        return START_NOT_STICKY
    }

    // =====================================================================
    // 캡처
    // =====================================================================
    private fun realSize(): Triple<Int, Int, Int> {
        val dm = getSystemService(DISPLAY_SERVICE) as DisplayManager
        val d = dm.getDisplay(Display.DEFAULT_DISPLAY)
        val m = DisplayMetrics()
        @Suppress("DEPRECATION")
        d.getRealMetrics(m)
        return Triple(m.widthPixels, m.heightPixels, m.densityDpi)
    }

    private fun computeTarget(w: Int, h: Int): Pair<Int, Int> {
        val scale = min(1.0, MAX_LONG_SIDE.toDouble() / maxOf(w, h))
        val cw = ((w * scale).toInt()) and 1.inv()
        val ch = ((h * scale).toInt()) and 1.inv()
        return Pair(maxOf(cw, 2), maxOf(ch, 2))
    }

    private fun setupCapture() {
        val (w, h, d) = realSize()
        val (cw, ch) = computeTarget(w, h)
        capW = cw; capH = ch; dpi = d
        val r = ImageReader.newInstance(capW, capH, PixelFormat.RGBA_8888, 3)
        r.setOnImageAvailableListener(onImage, cap)
        reader = r
        vd = mp?.createVirtualDisplay(
            "mirror", capW, capH, dpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            r.surface, null, cap
        )

        // 화면 회전 대응
        val dm = getSystemService(DISPLAY_SERVICE) as DisplayManager
        val l = object : DisplayManager.DisplayListener {
            override fun onDisplayAdded(displayId: Int) {}
            override fun onDisplayRemoved(displayId: Int) {}
            override fun onDisplayChanged(displayId: Int) {
                if (displayId == Display.DEFAULT_DISPLAY) {
                    rebuildIfNeeded()
                    main.post { clampDot() }
                }
            }
        }
        displayListener = l
        dm.registerDisplayListener(l, cap)
    }

    private fun rebuildIfNeeded() {
        if (!running) return
        val (w, h, d) = realSize()
        val (cw, ch) = computeTarget(w, h)
        if (cw == capW && ch == capH && d == dpi) return
        capW = cw; capH = ch; dpi = d
        held?.close(); held = null
        trailingScheduled = false
        val old = reader
        val nr = ImageReader.newInstance(capW, capH, PixelFormat.RGBA_8888, 3)
        nr.setOnImageAvailableListener(onImage, cap)
        reader = nr
        try {
            vd?.resize(capW, capH, dpi)
            vd?.surface = nr.surface
        } catch (_: Exception) {}
        try { old?.close() } catch (_: Exception) {}
    }

    private val onImage = ImageReader.OnImageAvailableListener { r ->
        if (r !== reader) {
            try { r.acquireLatestImage()?.close() } catch (_: Exception) {}
            return@OnImageAvailableListener
        }
        if (frozen) {
            // 한 앱 고정에서 대상 앱이 아닐 때: 인코딩 없이 최신 프레임만 보관
            try {
                val img = r.acquireLatestImage()
                if (img != null) { held?.close(); held = img }
            } catch (_: Exception) {}
            return@OnImageAvailableListener
        }
        val wait = lastEncode + MIN_INTERVAL_MS - SystemClock.uptimeMillis()
        if (wait > 0) {
            // 24fps 제한에 걸린 프레임은 버리지 않고 지연 전송(마지막 획 보존)
            if (!trailingScheduled) {
                trailingScheduled = true
                cap.postDelayed(trailing, wait)
            }
            return@OnImageAvailableListener
        }
        capture(r)
    }

    private val trailing = Runnable {
        trailingScheduled = false
        val r = reader
        if (r != null && !frozen) capture(r)
    }

    private fun capture(r: ImageReader) {
        val img = try { r.acquireLatestImage() } catch (_: Exception) { null } ?: return
        lastEncode = SystemClock.uptimeMillis()
        encode(img)
    }

    private fun encode(img: Image) {
        try {
            val plane = img.planes[0]
            val buf = plane.buffer
            val rowStride = plane.rowStride
            val w = img.width
            val h = img.height
            val rowBytes = w * 4

            var bmp = bitmap
            if (bmp == null || bmp.width != w || bmp.height != h) {
                bmp?.recycle()
                bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                bitmap = bmp
            }
            if (rowStride == rowBytes) {
                buf.rewind()
                bmp!!.copyPixelsFromBuffer(buf)
            } else {
                var rb = rowBuf
                if (rb == null || rb.capacity() != rowBytes * h) {
                    rb = ByteBuffer.allocateDirect(rowBytes * h)
                    rowBuf = rb
                }
                rb!!.clear()
                for (y in 0 until h) {
                    buf.limit(buf.capacity())
                    buf.position(y * rowStride)
                    buf.limit(y * rowStride + rowBytes)
                    rb.put(buf)
                }
                rb.rewind()
                bmp!!.copyPixelsFromBuffer(rb)
            }
            jpegOut.reset()
            bmp.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, jpegOut)
            server?.publish(jpegOut.toByteArray())
        } catch (_: Exception) {
        } finally {
            img.close()
        }
    }

    // =====================================================================
    // 한 앱 고정: 앞에 있는 앱 감시
    // =====================================================================
    private val fgPoll = object : Runnable {
        override fun run() {
            if (!running) return
            try {
                val usm = getSystemService(USAGE_STATS_SERVICE) as UsageStatsManager
                val now = System.currentTimeMillis()
                val from = if (lastEventQuery == 0L) now - 24 * 3600_000L else lastEventQuery - 1000
                val ev = usm.queryEvents(from, now)
                val e = UsageEvents.Event()
                while (ev.hasNextEvent()) {
                    ev.getNextEvent(e)
                    if (e.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND) currentFg = e.packageName
                }
                lastEventQuery = now
            } catch (_: Exception) {}
            val shouldFreeze = currentFg != target
            if (shouldFreeze != frozen) {
                frozen = shouldFreeze
                if (!frozen) {
                    // 대상 앱이 다시 앞으로 오면 보관해 둔 마지막 화면부터 송출
                    val h = held
                    held = null
                    if (h != null) {
                        lastEncode = SystemClock.uptimeMillis()
                        encode(h)
                    } else {
                        reader?.let { capture(it) }
                    }
                }
            }
            cap.postDelayed(this, 600)
        }
    }

    // =====================================================================
    // 상태 / 시트 보고
    // =====================================================================
    private fun statusJson(): String {
        val n = prefs.deviceName.replace("\\", "\\\\").replace("\"", "\\\"")
        return "{\"app\":\"mirror\",\"name\":\"$n\",\"on\":$running,\"w\":$capW,\"h\":$capH,\"mode\":\"$mode\"}"
    }

    private fun reportAsync(on: Boolean) {
        val url = prefs.scriptUrl
        val ipNow = ip ?: return
        if (url.isBlank()) return
        val name = prefs.deviceName
        val p = port
        Thread {
            repeat(3) {
                if (Net.report(url, name, ipNow, p, on)) return@Thread
                try { Thread.sleep(10_000) } catch (_: Exception) {}
            }
        }.start()
    }

    // IP가 바뀌면 자동 갱신 (요청은 변경 시에만)
    private val ipPoll = object : Runnable {
        override fun run() {
            if (!running) return
            val now = Net.findIp()
            if (now != null && now != ip) {
                ip = now
                updateNotif()
                reportAsync(true)
            } else if (now == null && ip != null) {
                ip = null
                updateNotif()
            }
            main.postDelayed(this, 15_000)
        }
    }

    // 30분마다 한 번 갱신
    private val heartbeat = object : Runnable {
        override fun run() {
            if (!running) return
            reportAsync(true)
            main.postDelayed(this, 30 * 60 * 1000L)
        }
    }

    private fun acquireWifiLock() {
        try {
            val wifi = applicationContext.getSystemService(WIFI_SERVICE) as WifiManager
            val m = if (Build.VERSION.SDK_INT >= 29) WifiManager.WIFI_MODE_FULL_LOW_LATENCY
            else WifiManager.WIFI_MODE_FULL_HIGH_PERF
            wifiLock = wifi.createWifiLock(m, "mirror:wifi").apply {
                setReferenceCounted(false)
                acquire()
            }
        } catch (_: Exception) {}
    }

    // =====================================================================
    // 알림
    // =====================================================================
    private fun createChannel() {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "화면 공유", NotificationManager.IMPORTANCE_LOW)
        )
    }

    private fun buildNotif(text: String): Notification {
        val stop = PendingIntent.getService(
            this, 0,
            Intent(this, ScreenStreamService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val open = PendingIntent.getActivity(
            this, 1, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val action = Notification.Action.Builder(
            Icon.createWithResource(this, android.R.drawable.ic_menu_close_clear_cancel), "종료", stop
        ).build()
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("화면 공유 중")
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .addAction(action)
            .build()
    }

    private fun updateNotif() {
        val t = if (ip != null) "http://$ip:$port" else "네트워크 연결 없음"
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NID, buildNotif(t))
    }

    // =====================================================================
    // 회색 네모 오버레이 (드래그 / 짧은 탭 무시 / 길게 누르면 종료 확인)
    // =====================================================================
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun showOverlay() {
        if (!Settings.canDrawOverlays(this)) return
        val w = getSystemService(WINDOW_SERVICE) as WindowManager
        wm = w
        val sz = dp(36)
        val v = View(this)
        v.background = GradientDrawable().apply {
            setColor(0xCC808080.toInt())
            cornerRadius = dp(4).toFloat()
        }
        val lp = WindowManager.LayoutParams(
            sz, sz,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        )
        lp.gravity = Gravity.TOP or Gravity.START
        val (sw, sh, _) = realSize()
        lp.x = sw - sz - dp(8)
        lp.y = sh - sz - dp(8)
        dotLp = lp

        val slop = ViewConfiguration.get(this).scaledTouchSlop
        var downX = 0f; var downY = 0f
        var startX = 0; var startY = 0
        var moved = false
        val longRun = Runnable { if (!moved) showConfirm() }

        v.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = e.rawX; downY = e.rawY
                    startX = lp.x; startY = lp.y
                    moved = false
                    main.postDelayed(longRun, 700)
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - downX
                    val dy = e.rawY - downY
                    if (!moved && (abs(dx) > slop || abs(dy) > slop)) {
                        moved = true
                        main.removeCallbacks(longRun)
                    }
                    if (moved) {
                        lp.x = startX + dx.toInt()
                        lp.y = startY + dy.toInt()
                        clampDot()
                    }
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> main.removeCallbacks(longRun)
            }
            true
        }
        try {
            w.addView(v, lp)
            dot = v
        } catch (_: Exception) {}
    }

    private fun clampDot() {
        val v = dot ?: return
        val lp = dotLp ?: return
        val (sw, sh, _) = realSize()
        lp.x = lp.x.coerceIn(0, maxOf(0, sw - lp.width))
        lp.y = lp.y.coerceIn(0, maxOf(0, sh - lp.height))
        try { wm?.updateViewLayout(v, lp) } catch (_: Exception) {}
    }

    private val autoHideConfirm = Runnable { hideConfirm() }

    private fun showConfirm() {
        if (confirmView != null) return
        val w = wm ?: return
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(20), dp(24), dp(12))
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = dp(14).toFloat()
            }
        }
        box.addView(TextView(this).apply {
            text = "공유를 종료하시겠습니까?"
            setTextColor(Color.BLACK)
            textSize = 18f
        })
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.END
        }
        row.addView(Button(this).apply {
            text = "취소"
            setOnClickListener { hideConfirm() }
        })
        row.addView(Button(this).apply {
            text = "종료하기"
            setOnClickListener { hideConfirm(); stopSelf() }
        })
        box.addView(row)
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        )
        lp.gravity = Gravity.CENTER
        try {
            w.addView(box, lp)
            confirmView = box
            main.postDelayed(autoHideConfirm, 10_000)
        } catch (_: Exception) {}
    }

    private fun hideConfirm() {
        main.removeCallbacks(autoHideConfirm)
        confirmView?.let { try { wm?.removeView(it) } catch (_: Exception) {} }
        confirmView = null
    }

    private fun removeOverlay() {
        hideConfirm()
        dot?.let { try { wm?.removeView(it) } catch (_: Exception) {} }
        dot = null
    }

    // =====================================================================
    // 종료
    // =====================================================================
    override fun onDestroy() {
        val wasRunning = running
        running = false
        main.removeCallbacksAndMessages(null)
        removeOverlay()

        if (wasRunning) {
            // "꺼짐"을 시트에 기록 (최대 3초 대기)
            val url = prefs.scriptUrl
            val ipNow = ip
            if (url.isNotBlank() && ipNow != null) {
                val name = prefs.deviceName
                val p = port
                val t = Thread { Net.report(url, name, ipNow, p, false) }
                t.start()
                try { t.join(3000) } catch (_: Exception) {}
            }
        }

        try {
            displayListener?.let {
                (getSystemService(DISPLAY_SERVICE) as DisplayManager).unregisterDisplayListener(it)
            }
        } catch (_: Exception) {}
        if (::cap.isInitialized) cap.removeCallbacksAndMessages(null)
        try { held?.close() } catch (_: Exception) {}
        held = null
        try { vd?.release() } catch (_: Exception) {}
        vd = null
        try { reader?.close() } catch (_: Exception) {}
        reader = null
        try {
            mpCallback?.let { mp?.unregisterCallback(it) }
            mp?.stop()
        } catch (_: Exception) {}
        mp = null
        server?.stop()
        server = null
        try { wifiLock?.release() } catch (_: Exception) {}
        wifiLock = null
        if (::capThread.isInitialized) capThread.quitSafely()
        bitmap?.recycle()
        bitmap = null
        rowBuf = null
        port = 0
        super.onDestroy()
    }
}
