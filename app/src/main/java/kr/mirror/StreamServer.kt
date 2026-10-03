package kr.mirror

import java.io.BufferedOutputStream
import java.io.IOException
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock

/**
 * 순수 ServerSocket 기반 초경량 서버.
 *  /        : 수신용 간단 HTML
 *  /stream  : MJPEG (multipart/x-mixed-replace)
 *  /status  : 상태 JSON (CORS)
 *  /stop    : 공유 종료 (CORS)
 */
class StreamServer(
    private val statusJson: () -> String,
    private val onStop: () -> Unit
) {
    private var server: ServerSocket? = null
    private val pool = Executors.newCachedThreadPool()
    private val lk = ReentrantLock()
    private val cond = lk.newCondition()

    @Volatile private var frame: ByteArray? = null
    @Volatile private var version = 0L
    @Volatile private var running = false
    @Volatile var port = 0
        private set

    /** 8080부터 비어 있는 포트를 찾아 시작. 사용된 포트 반환 */
    fun start(): Int {
        for (p in 8080..8099) {
            try {
                val s = ServerSocket()
                s.reuseAddress = true
                s.bind(InetSocketAddress(p))
                server = s
                port = p
                break
            } catch (_: IOException) {}
        }
        if (server == null) throw IOException("사용 가능한 포트가 없습니다")
        running = true
        pool.execute { acceptLoop() }
        return port
    }

    fun stop() {
        running = false
        try { server?.close() } catch (_: Exception) {}
        lk.lock()
        try { cond.signalAll() } finally { lk.unlock() }
        pool.shutdownNow()
    }

    /** 새 프레임 게시 (인코딩은 한 번만, 모든 접속자가 공유) */
    fun publish(jpeg: ByteArray) {
        lk.lock()
        try {
            frame = jpeg
            version++
            cond.signalAll()
        } finally {
            lk.unlock()
        }
    }

    private fun acceptLoop() {
        val s = server ?: return
        while (running) {
            try {
                val c = s.accept()
                c.tcpNoDelay = true
                pool.execute { handle(c) }
            } catch (_: Exception) {
                if (!running) return
            }
        }
    }

    private val cors = "Access-Control-Allow-Origin: *\r\n" +
        "Access-Control-Allow-Methods: GET, OPTIONS\r\n" +
        "Access-Control-Allow-Headers: *\r\n" +
        "Access-Control-Allow-Private-Network: true\r\n"

    private fun handle(sock: Socket) {
        try {
            sock.tcpNoDelay = true
            sock.soTimeout = 10000
            val reader = sock.getInputStream().bufferedReader(Charsets.ISO_8859_1)
            val reqLine = reader.readLine() ?: return
            while (true) {
                val l = reader.readLine() ?: break
                if (l.isEmpty()) break
            }
            val parts = reqLine.split(" ")
            val method = parts.getOrElse(0) { "GET" }
            val path = parts.getOrElse(1) { "/" }.substringBefore('?')
            val out = sock.getOutputStream()

            when {
                method == "OPTIONS" -> {
                    out.write(("HTTP/1.1 204 No Content\r\n$cors" + "Content-Length: 0\r\nConnection: close\r\n\r\n").toByteArray())
                    out.flush()
                }
                path == "/stream" -> streamTo(sock, out)
                path == "/status" -> simple(out, "application/json; charset=utf-8", statusJson())
                path == "/stop" -> {
                    simple(out, "text/plain", "ok")
                    onStop()
                }
                path == "/" -> simple(out, "text/html; charset=utf-8", VIEWER_HTML)
                else -> {
                    out.write(("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").toByteArray())
                    out.flush()
                }
            }
        } catch (_: Exception) {
        } finally {
            try { sock.close() } catch (_: Exception) {}
        }
    }

    private fun simple(out: OutputStream, type: String, body: String) {
        val b = body.toByteArray(Charsets.UTF_8)
        val head = "HTTP/1.1 200 OK\r\nContent-Type: $type\r\n$cors" +
            "Cache-Control: no-store\r\nContent-Length: ${b.size}\r\nConnection: close\r\n\r\n"
        out.write(head.toByteArray())
        out.write(b)
        out.flush()
    }

    private fun streamTo(sock: Socket, raw: OutputStream) {
        sock.soTimeout = 0
        val out = BufferedOutputStream(raw, 64 * 1024)
        out.write(
            ("HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=frame\r\n" +
                "Cache-Control: no-cache, no-store\r\nPragma: no-cache\r\n" +
                "Access-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n").toByteArray()
        )
        out.flush()
        var sent = -1L
        while (running) {
            var f: ByteArray?
            var v: Long
            lk.lock()
            try {
                // 새 프레임이 없으면 5초 후 마지막 프레임을 다시 보냄(끊긴 접속 정리용)
                if (version == sent) cond.await(5, TimeUnit.SECONDS)
                f = frame
                v = version
            } finally {
                lk.unlock()
            }
            if (!running) break
            if (f == null) continue
            out.write(("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${f.size}\r\n\r\n").toByteArray())
            out.write(f)
            out.write("\r\n".toByteArray())
            out.flush() // 버퍼링 없이 즉시 전송
            sent = v
        }
    }

    companion object {
        private const val VIEWER_HTML =
            "<!doctype html><html><head><meta charset=\"utf-8\">" +
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
            "<title>화면 미러링</title><style>html,body{margin:0;height:100%;background:#000}" +
            "img{width:100%;height:100%;object-fit:contain}</style></head>" +
            "<body><img src=\"/stream\"></body></html>"
    }
}
