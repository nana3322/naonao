package kr.mirror

import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.URL
import java.net.URLEncoder

object Net {
    /** 와이파이/핫스팟/유선의 사설 IPv4 중 가장 적합한 것 (모바일 데이터 제외) */
    fun findIp(): String? {
        var best: String? = null
        var bestScore = Int.MAX_VALUE
        try {
            val list = NetworkInterface.getNetworkInterfaces() ?: return null
            for (ni in list) {
                if (!ni.isUp || ni.isLoopback) continue
                val n = ni.name.lowercase()
                if (n.startsWith("rmnet") || n.startsWith("ccmni") || n.startsWith("tun") ||
                    n.startsWith("dummy") || n.startsWith("p2p")) continue
                val score = when {
                    n.startsWith("wlan0") -> 0
                    n.startsWith("wlan") -> 1
                    n.startsWith("ap") || n.startsWith("swlan") -> 2
                    n.startsWith("eth") -> 3
                    else -> 5
                }
                for (a in ni.inetAddresses) {
                    if (a is Inet4Address && !a.isLoopbackAddress && a.isSiteLocalAddress && score < bestScore) {
                        best = a.hostAddress
                        bestScore = score
                    }
                }
            }
        } catch (_: Exception) {}
        return best
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    /** Apps Script 웹앱에 기기 상태 저장. 성공 여부 반환 */
    fun report(url: String, name: String, ip: String, port: Int, on: Boolean): Boolean {
        if (url.isBlank()) return false
        return try {
            val q = "action=update&name=${enc(name)}&ip=${enc(ip)}&port=$port&on=${if (on) 1 else 0}"
            val u = URL(url + (if (url.contains("?")) "&" else "?") + q)
            val c = u.openConnection() as HttpURLConnection
            c.connectTimeout = 8000
            c.readTimeout = 8000
            c.instanceFollowRedirects = true
            val ok = c.responseCode in 200..299
            c.inputStream.use { it.readBytes() }
            c.disconnect()
            ok
        } catch (_: Exception) {
            false
        }
    }
}
