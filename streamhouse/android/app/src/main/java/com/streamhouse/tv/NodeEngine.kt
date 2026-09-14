package com.streamhouse.tv

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.ZipInputStream

/**
 * StreamHouse itself — web app, add-ons, torrent engine — running inside the
 * app, so a TV or a phone needs no computer.
 *
 * It is the same Node.js server a computer runs, executed by the libnode.so
 * that nodejs-mobile builds for Android. Node can be started once per process
 * and never stopped, so the first screen that needs it starts it, and it lives
 * as long as the app does.
 */
object NodeEngine {

    const val PORT = 11471
    const val ADDRESS = "http://127.0.0.1:$PORT"

    private const val START_TIMEOUT_MS = 180_000L

    private enum class State { IDLE, STARTING, READY, FAILED }

    @Volatile
    private var state = State.IDLE

    /** Why the engine is not running, for the error screen. */
    @Volatile
    var failure: String? = null
        private set

    /** Node exits only by crashing, and cannot start again in this process. */
    val stopped: Boolean get() = state == State.FAILED

    private val main = Handler(Looper.getMainLooper())

    init {
        // Loads libnode.so along with it, as a dependency.
        System.loadLibrary("native-lib")
    }

    private external fun setEnv(name: String, value: String)
    private external fun startNode(arguments: Array<String>): Int

    /**
     * Starts the engine unless it is already running, then calls [onReady] on
     * the main thread: true once the server answers, false if it never will.
     */
    fun start(context: Context, onReady: (Boolean) -> Unit) {
        val app = context.applicationContext
        synchronized(this) {
            if (state == State.IDLE) {
                state = State.STARTING
                // V8 wants a bigger stack than a thread gets by default.
                Thread(null, { run(app) }, "streamhouse-node", 16L * 1024 * 1024).start()
            }
        }
        Thread {
            val deadline = System.currentTimeMillis() + START_TIMEOUT_MS
            while (state != State.FAILED && !answers() && System.currentTimeMillis() < deadline) {
                Thread.sleep(400)
            }
            val ready = state != State.FAILED && answers()
            if (ready) {
                state = State.READY
            } else if (state != State.FAILED) {
                failure = "StreamHouse did not start within three minutes."
            }
            main.post { onReady(ready) }
        }.start()
    }

    private fun run(context: Context) {
        try {
            val project = unpack(context)
            val data = File(context.filesDir, "data").apply { mkdirs() }
            val media = File(context.getExternalFilesDir(null) ?: context.filesDir, "Downloads").apply { mkdirs() }
            mapOf(
                "STREAMHOUSE_DIR" to data.absolutePath,
                "STREAMHOUSE_DOWNLOADS" to media.absolutePath,
                "STREAMHOUSE_DEVICE_NAME" to deviceName(context),
                // TVs and phones have little storage: a streamed film is
                // cleared once nobody has watched it for half an hour.
                "STREAMHOUSE_STREAM_CACHE_ONLY" to "1",
                "PORT" to PORT.toString(),
                "HOST" to "127.0.0.1",
                "HOME" to context.filesDir.absolutePath,
                "TMPDIR" to context.cacheDir.absolutePath
            ).forEach { (name, value) -> setEnv(name, value) }

            val code = startNode(arrayOf("node", File(project, "server/index.js").absolutePath))
            fail("StreamHouse stopped (exit code $code).")
        } catch (error: Throwable) {
            fail(error.message ?: error.toString())
        }
    }

    private fun fail(reason: String) {
        failure = reason
        state = State.FAILED
    }

    /**
     * The server and its node_modules ship as one zip in the APK's assets.
     * They are unpacked on first run, and again after every update.
     */
    private fun unpack(context: Context): File {
        val target = File(context.filesDir, "nodejs-project")
        val stamp = File(context.filesDir, "nodejs-project.stamp")
        @Suppress("DEPRECATION")
        val version = context.packageManager.getPackageInfo(context.packageName, 0).lastUpdateTime.toString()
        if (target.isDirectory && stamp.isFile && stamp.readText() == version) return target

        target.deleteRecursively()
        val root = target.canonicalPath + File.separator
        ZipInputStream(context.assets.open("nodejs-project.zip").buffered()).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                val file = File(target, entry.name)
                if (!file.canonicalPath.startsWith(root)) continue
                if (entry.isDirectory) {
                    file.mkdirs()
                } else {
                    file.parentFile?.mkdirs()
                    file.outputStream().use { zip.copyTo(it) }
                }
            }
        }
        stamp.writeText(version)
        return target
    }

    /** What the account server lists this device as: the name set in Android's settings. */
    private fun deviceName(context: Context): String =
        Settings.Global.getString(context.contentResolver, "device_name")
            ?: "${Build.MANUFACTURER} ${Build.MODEL}"

    private fun answers(): Boolean = try {
        val connection = URL("$ADDRESS/api/health").openConnection() as HttpURLConnection
        connection.connectTimeout = 1000
        connection.readTimeout = 2000
        val ok = connection.responseCode == 200
        connection.disconnect()
        ok
    } catch (error: Exception) {
        false
    }
}
