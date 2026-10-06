package com.streamhouse.tv

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Keeps the app up to date from the `tv-latest` release CI publishes, where a
 * `version.json` beside the APK says which build it is. When that build is
 * newer than this one, the app offers it, downloads it and hands it to
 * Android's installer.
 *
 * Android still asks before installing — a sideloaded app cannot replace
 * itself silently — and the first time, it asks to allow installs from
 * StreamHouse. Every CI build is signed with the same key, so each installs
 * over the last and the app keeps its data.
 */
object Updater {

    private const val CHECK_EVERY_MS = 15 * 60 * 1000L
    private const val LATER_MS = 24 * 60 * 60 * 1000L
    private const val APK = "streamhouse-tv.apk"

    private class Release(val versionCode: Int, val versionName: String, val sha256: String)

    /** Empty unless CI built this with the StreamHouse key: nothing else could install the release. */
    private val base = BuildConfig.UPDATE_URL

    /** When the release was last read, on the [SystemClock.elapsedRealtime] clock. */
    private var lastCheck = 0L
    private var busy = false

    /**
     * Whenever the app comes to the front — a TV keeps it alive for days, so
     * opening it seldom starts it afresh — at most every quarter of an hour,
     * and not for a day after "Later".
     */
    fun checkQuietly(activity: Activity) {
        if (base.isEmpty() || busy) return
        if (lastCheck != 0L && SystemClock.elapsedRealtime() - lastCheck < CHECK_EVERY_MS) return
        if (System.currentTimeMillis() < Prefs.updateLaterUntil(activity)) return
        fetch(activity) { release ->
            if (release != null && release.versionCode > BuildConfig.VERSION_CODE) offer(activity, release)
        }
    }

    /** "Check for updates" in Settings or on the setup screen, which says what it found either way. */
    fun checkNow(activity: Activity) {
        if (base.isEmpty()) {
            toast(activity, activity.getString(R.string.update_unsupported))
            return
        }
        if (busy) return
        toast(activity, activity.getString(R.string.update_checking))
        fetch(activity) { release ->
            when {
                release == null -> toast(activity, activity.getString(R.string.update_check_failed))
                release.versionCode > BuildConfig.VERSION_CODE -> offer(activity, release)
                else -> toast(activity, activity.getString(R.string.update_none, BuildConfig.VERSION_NAME))
            }
        }
    }

    private fun fetch(activity: Activity, done: (Release?) -> Unit) {
        busy = true
        Thread {
            val release = try {
                val connection = open("${base}version.json")
                try {
                    if (connection.responseCode != 200) null else {
                        val json = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
                        Release(json.getInt("versionCode"), json.getString("versionName"), json.getString("sha256"))
                    }
                } finally {
                    connection.disconnect()
                }
            } catch (error: Exception) {
                null
            }
            activity.runOnUiThread {
                busy = false
                if (release != null) lastCheck = SystemClock.elapsedRealtime()
                if (!activity.isFinishing && !activity.isDestroyed) done(release)
            }
        }.start()
    }

    private fun offer(activity: Activity, release: Release) {
        AlertDialog.Builder(activity)
            .setTitle(R.string.update_title)
            .setMessage(activity.getString(R.string.update_message, release.versionName, BuildConfig.VERSION_NAME))
            .setPositiveButton(R.string.update_now) { _, _ -> download(activity, release) }
            .setNegativeButton(R.string.update_later) { _, _ ->
                Prefs.setUpdateLaterUntil(activity, System.currentTimeMillis() + LATER_MS)
            }
            .show()
    }

    private fun download(activity: Activity, release: Release) {
        busy = true
        val cancelled = AtomicBoolean(false)
        val bar = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply { max = 100 }
        val padding = (24 * activity.resources.displayMetrics.density).toInt()
        val frame = FrameLayout(activity).apply {
            setPadding(padding, padding / 2, padding, 0)
            addView(bar)
        }
        val dialog = AlertDialog.Builder(activity)
            .setTitle(R.string.update_downloading)
            .setView(frame)
            .setNegativeButton(R.string.update_cancel) { _, _ -> cancelled.set(true) }
            .setCancelable(false)
            .show()

        Thread {
            val apk = try {
                fetchApk(activity, release, cancelled) { percent -> activity.runOnUiThread { bar.progress = percent } }
            } catch (error: Exception) {
                null
            }
            activity.runOnUiThread {
                busy = false
                if (activity.isFinishing || activity.isDestroyed) return@runOnUiThread
                dialog.dismiss()
                when {
                    cancelled.get() -> Unit
                    apk == null -> toast(activity, activity.getString(R.string.update_download_failed))
                    else -> install(activity, apk)
                }
            }
        }.start()
    }

    /** The APK, once all of it has arrived and matches `version.json`; null otherwise. */
    private fun fetchApk(context: Context, release: Release, cancelled: AtomicBoolean, progress: (Int) -> Unit): File? {
        val folder = File(context.cacheDir, "updates")
        folder.deleteRecursively()
        folder.mkdirs()
        val file = File(folder, APK)
        val digest = MessageDigest.getInstance("SHA-256")

        val connection = open("$base$APK")
        try {
            if (connection.responseCode != 200) return null
            val total = connection.contentLengthLong
            connection.inputStream.use { input ->
                file.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    var received = 0L
                    var shown = -1
                    var count = input.read(buffer)
                    while (count >= 0 && !cancelled.get()) {
                        output.write(buffer, 0, count)
                        digest.update(buffer, 0, count)
                        received += count
                        val percent = if (total > 0) (received * 100 / total).toInt() else 0
                        if (percent != shown) {
                            shown = percent
                            progress(percent)
                        }
                        count = input.read(buffer)
                    }
                }
            }
        } finally {
            connection.disconnect()
        }
        if (cancelled.get()) return null

        // A download cut short, or a newer build published in the meantime.
        val sha256 = digest.digest().joinToString("") { "%02x".format(it) }
        return file.takeIf { sha256.equals(release.sha256, ignoreCase = true) }
    }

    private fun install(activity: Activity, apk: File) {
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.updates", apk)
        // Android's installer, which also asks to allow installs from
        // StreamHouse the first time. VIEW is how Downloader and the browser
        // reach it, for a device whose installer does not answer INSTALL_PACKAGE.
        @Suppress("DEPRECATION")
        val actions = listOf(Intent.ACTION_INSTALL_PACKAGE, Intent.ACTION_VIEW)
        for (action in actions) {
            val intent = Intent(action)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            try {
                activity.startActivity(intent)
                return
            } catch (error: ActivityNotFoundException) {
                continue
            }
        }
        toast(activity, activity.getString(R.string.update_no_installer))
    }

    private fun open(url: String): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 10_000
            readTimeout = 30_000
            useCaches = false
        }

    private fun toast(context: Context, message: String) {
        Toast.makeText(context, message, Toast.LENGTH_LONG).show()
    }
}
