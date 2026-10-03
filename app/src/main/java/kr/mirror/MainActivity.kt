package kr.mirror

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.app.AppOpsManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.Drawable
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {

    private val REQ_CAPTURE = 1
    private val REQ_NOTI = 4

    private lateinit var prefs: Prefs
    private lateinit var status: TextView
    private lateinit var startBtn: Button
    private lateinit var rbFull: RadioButton
    private lateinit var rbApp: RadioButton
    private lateinit var appRow: LinearLayout
    private lateinit var appName: TextView
    private val ui = Handler(Looper.getMainLooper())

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(20), dp(24), dp(24))
        }

        // 상단: 제목 + 설정(오른쪽 위)
        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        top.addView(TextView(this).apply {
            text = "화면 미러링"
            textSize = 24f
            setTextColor(Color.BLACK)
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        top.addView(Button(this).apply {
            text = "⚙ 설정"
            setOnClickListener { showSettings() }
        })
        root.addView(top)

        status = TextView(this).apply {
            textSize = 16f
            setTextColor(Color.DKGRAY)
            setPadding(0, dp(20), 0, dp(20))
        }
        root.addView(status)

        root.addView(TextView(this).apply {
            text = "공유 방식"
            textSize = 14f
        })
        val group = RadioGroup(this)
        rbFull = RadioButton(this).apply { text = "전체 화면 고정"; id = View.generateViewId() }
        rbApp = RadioButton(this).apply { text = "한 앱 고정"; id = View.generateViewId() }
        group.addView(rbFull)
        group.addView(rbApp)
        root.addView(group)
        if (prefs.mode == "app") rbApp.isChecked = true else rbFull.isChecked = true
        group.setOnCheckedChangeListener { _, id ->
            prefs.mode = if (id == rbApp.id) "app" else "full"
            refresh()
        }

        appRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8), dp(4), 0, dp(8))
        }
        appName = TextView(this).apply { textSize = 15f; setTextColor(Color.BLACK) }
        appRow.addView(appName, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        appRow.addView(Button(this).apply {
            text = "앱 선택"
            setOnClickListener { showAppPicker() }
        })
        root.addView(appRow)

        startBtn = Button(this).apply {
            textSize = 20f
            setOnClickListener { onStartClicked() }
        }
        root.addView(startBtn, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(64)
        ).apply { topMargin = dp(24) })

        setContentView(ScrollView(this).apply { addView(root) })
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    private fun refresh() {
        val running = ScreenStreamService.running
        status.text = if (running) {
            val ip = ScreenStreamService.ip
            if (ip != null) "공유 중\nhttp://$ip:${ScreenStreamService.port}" else "공유 중 (네트워크 연결 없음)"
        } else "대기 중"
        startBtn.text = if (running) "공유 종료하기" else "시작하기"
        rbFull.isEnabled = !running
        rbApp.isEnabled = !running
        val appMode = prefs.mode == "app"
        appRow.visibility = if (appMode) View.VISIBLE else View.GONE
        val pkg = prefs.targetPkg
        appName.text = if (pkg.isBlank()) "선택한 앱: 없음" else "선택한 앱: ${labelOf(pkg)}"
    }

    private fun labelOf(pkg: String): String = try {
        packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
    } catch (_: Exception) { pkg }

    // ------------------------------------------------------------------
    // 시작 흐름
    // ------------------------------------------------------------------
    private fun onStartClicked() {
        if (ScreenStreamService.running) {
            startService(Intent(this, ScreenStreamService::class.java).setAction(ScreenStreamService.ACTION_STOP))
            ui.postDelayed({ refresh() }, 600)
            return
        }
        begin(false)
    }

    private fun begin(notiAsked: Boolean) {
        val appMode = prefs.mode == "app"
        if (appMode && prefs.targetPkg.isBlank()) {
            Toast.makeText(this, "먼저 공유할 앱을 선택하세요", Toast.LENGTH_SHORT).show()
            showAppPicker()
            return
        }
        if (!Settings.canDrawOverlays(this)) {
            Toast.makeText(this, "'다른 앱 위에 표시'를 허용한 뒤 다시 시작하세요", Toast.LENGTH_LONG).show()
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
            return
        }
        if (appMode && !hasUsageAccess()) {
            Toast.makeText(this, "'사용 정보 접근'을 허용한 뒤 다시 시작하세요", Toast.LENGTH_LONG).show()
            startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
            return
        }
        if (Build.VERSION.SDK_INT >= 33 && !notiAsked &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTI)
            return
        }
        val mpm = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        // 안드로이드 14+: 항상 '전체 화면' 공유로 고정 (한 앱 선택 단계 없음)
        val intent = if (Build.VERSION.SDK_INT >= 34) {
            mpm.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
        } else {
            mpm.createScreenCaptureIntent()
        }
        @Suppress("DEPRECATION")
        startActivityForResult(intent, REQ_CAPTURE)
    }

    @Deprecated("Deprecated in Java")
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_NOTI) begin(true)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_CAPTURE) {
            if (resultCode == RESULT_OK && data != null) {
                val i = Intent(this, ScreenStreamService::class.java)
                    .putExtra(ScreenStreamService.EXTRA_CODE, resultCode)
                    .putExtra(ScreenStreamService.EXTRA_DATA, data)
                    .putExtra(ScreenStreamService.EXTRA_MODE, prefs.mode)
                    .putExtra(ScreenStreamService.EXTRA_TARGET, prefs.targetPkg)
                startForegroundService(i)
                ui.postDelayed({ refresh() }, 800)
            } else {
                Toast.makeText(this, "화면 공유가 취소되었습니다", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun hasUsageAccess(): Boolean {
        val ops = getSystemService(APP_OPS_SERVICE) as AppOpsManager
        val m = if (Build.VERSION.SDK_INT >= 29) {
            ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), packageName)
        } else {
            @Suppress("DEPRECATION")
            ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), packageName)
        }
        return m == AppOpsManager.MODE_ALLOWED
    }

    // ------------------------------------------------------------------
    // 설정 (오른쪽 위)
    // ------------------------------------------------------------------
    private fun showSettings() {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(12), dp(20), dp(4))
        }
        box.addView(TextView(this).apply { text = "기기 이름 (여러 대 사용 시 구분용)" })
        val nameEt = EditText(this).apply { setText(prefs.deviceName); setSingleLine() }
        box.addView(nameEt)

        box.addView(TextView(this).apply {
            text = "Apps Script URL"
            setPadding(0, dp(12), 0, 0)
        })
        val urlEt = EditText(this).apply {
            setText(prefs.scriptUrl)
            hint = "https://script.google.com/macros/s/.../exec"
            setSingleLine()
        }
        box.addView(urlEt)

        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        row.addView(Button(this).apply {
            text = "저장"
            setOnClickListener {
                prefs.scriptUrl = urlEt.text.toString()
                prefs.deviceName = nameEt.text.toString()
                Toast.makeText(context, "저장했습니다", Toast.LENGTH_SHORT).show()
            }
        })
        row.addView(Button(this).apply {
            text = "URL 초기화"
            setOnClickListener {
                prefs.scriptUrl = ""
                urlEt.setText("")
                Toast.makeText(context, "초기화했습니다", Toast.LENGTH_SHORT).show()
            }
        })
        box.addView(row)

        val ipTv = TextView(this).apply {
            textSize = 16f
            setTextColor(Color.BLACK)
            setPadding(0, dp(8), 0, 0)
        }
        box.addView(Button(this).apply {
            text = "현재 IP 주소 확인"
            setOnClickListener { ipTv.text = Net.findIp() ?: "와이파이/핫스팟에 연결되어 있지 않습니다" }
        })
        box.addView(ipTv)

        AlertDialog.Builder(this)
            .setTitle("설정")
            .setView(ScrollView(this).apply { addView(box) })
            .setPositiveButton("닫기", null)
            .show()
    }

    // ------------------------------------------------------------------
    // 앱 선택 (자주 쓰는 앱 ★ 고정 → 위에 표시)
    // ------------------------------------------------------------------
    private class AppItem(val label: String, val pkg: String, val icon: Drawable)

    private fun showAppPicker() {
        val pm = packageManager
        val q = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val items = pm.queryIntentActivities(q, 0)
            .map { it.activityInfo.packageName to it }
            .filter { it.first != packageName }
            .distinctBy { it.first }
            .map { (pkg, ri) -> AppItem(ri.loadLabel(pm).toString(), pkg, ri.loadIcon(pm)) }
            .toMutableList()
        var pinned = prefs.pinned.toMutableSet()

        fun sorted(): List<AppItem> =
            items.sortedWith(compareBy<AppItem>({ it.pkg !in pinned }, { it.label.lowercase() }))

        var data = sorted()
        val lv = ListView(this)
        lateinit var dialog: AlertDialog

        val adapter = object : BaseAdapter() {
            override fun getCount() = data.size
            override fun getItem(p: Int) = data[p]
            override fun getItemId(p: Int) = p.toLong()
            override fun getView(p: Int, convert: View?, parent: ViewGroup?): View {
                val item = data[p]
                val row = LinearLayout(this@MainActivity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(dp(12), dp(8), dp(4), dp(8))
                }
                row.addView(ImageView(this@MainActivity).apply { setImageDrawable(item.icon) },
                    LinearLayout.LayoutParams(dp(40), dp(40)))
                row.addView(TextView(this@MainActivity).apply {
                    text = item.label
                    textSize = 16f
                    setTextColor(Color.BLACK)
                    setPadding(dp(12), 0, 0, 0)
                }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                row.addView(TextView(this@MainActivity).apply {
                    text = if (item.pkg in pinned) "★" else "☆"
                    textSize = 26f
                    setTextColor(if (item.pkg in pinned) 0xFFF9A825.toInt() else Color.GRAY)
                    setPadding(dp(14), dp(4), dp(14), dp(4))
                    setOnClickListener {
                        val pk = data[p].pkg
                        if (pk in pinned) pinned.remove(pk) else pinned.add(pk)
                        prefs.pinned = pinned
                        data = sorted()
                        notifyDataSetChanged()
                    }
                })
                return row
            }
        }
        lv.adapter = adapter
        lv.setOnItemClickListener { _, _, pos, _ ->
            prefs.targetPkg = data[pos].pkg
            dialog.dismiss()
            refresh()
        }
        dialog = AlertDialog.Builder(this)
            .setTitle("공유할 앱 선택  (★ = 위에 고정)")
            .setView(lv)
            .setNegativeButton("취소", null)
            .create()
        dialog.show()
    }
}
