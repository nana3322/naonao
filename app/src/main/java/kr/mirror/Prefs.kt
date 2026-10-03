package kr.mirror

import android.content.Context
import android.os.Build

class Prefs(ctx: Context) {
    private val sp = ctx.applicationContext.getSharedPreferences("mirror", Context.MODE_PRIVATE)

    var scriptUrl: String
        get() = sp.getString("url", "") ?: ""
        set(v) { sp.edit().putString("url", v.trim()).apply() }

    var deviceName: String
        get() = sp.getString("name", null)?.takeIf { it.isNotBlank() } ?: Build.MODEL
        set(v) { sp.edit().putString("name", v.trim()).apply() }

    /** "full" = 전체 화면 고정, "app" = 한 앱 고정 */
    var mode: String
        get() = sp.getString("mode", "full") ?: "full"
        set(v) { sp.edit().putString("mode", v).apply() }

    var targetPkg: String
        get() = sp.getString("target", "") ?: ""
        set(v) { sp.edit().putString("target", v).apply() }

    var pinned: Set<String>
        get() = sp.getStringSet("pinned", emptySet()) ?: emptySet()
        set(v) { sp.edit().putStringSet("pinned", HashSet(v)).apply() }
}
