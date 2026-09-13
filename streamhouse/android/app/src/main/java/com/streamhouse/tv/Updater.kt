package com.streamhouse.tv

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Keeping a sideloaded app up to date.
 *
 * There is no store behind an APK installed by hand, so the TV asks its own
 * StreamHouse server what the newest build is and downloads it from there. The
 * server has the dependable internet connection of the two, and asking it means
 * no release URL is baked in here.
 *
 * Everything is best effort: a server that is an old version, offline, or
 * simply has nothing newer leaves the app exactly as it was.
 */
object Updater {

    /** A build waiting on the server. */
    data class Release(val versionCode: Int, val versionName: String)

    private const val APK_NAME = "streamhouse-tv.apk"
    private const val APK_MIME = "application/vnd.android.package-archive"

    fun installedVersion(context: Context): Int = try {
        @Suppress("DEPRECATION")
        context.packageManager.getPackageInfo(context.packageName, 0).versionCode
    } catch (ignored: Exception) {
        0
    }

    /** Null when there is nothing newer — or when anything at all goes wrong. */
    fun check(context: Context, server: String): Release? = try {
        val url = URL("$server/api/tv/update?installed=${installedVersion(context)}")
        val connection = (url.openConnection() as HttpURLConnection).apply {
            connectTimeout = 5000
            readTimeout = 5000
        }
        val body = connection.inputStream.bufferedReader().use { it.readText() }
        connection.disconnect()
        val json = JSONObject(body)
        if (json.optBoolean("available")) {
            Release(json.optInt("versionCode"), json.optString("versionName"))
        } else {
            null
        }
    } catch (ignored: Exception) {
        null
    }

    /** Pulls the APK down beside the app's own files. Null if it did not arrive. */
    fun download(context: Context, server: String): File? = try {
        val connection = (URL("$server/api/tv/apk").openConnection() as HttpURLConnection).apply {
            connectTimeout = 8000
            readTimeout = 60000
            instanceFollowRedirects = true
        }
        val file = File(cacheDir(context), APK_NAME)
        connection.inputStream.use { input ->
            file.outputStream().use { output -> input.copyTo(output) }
        }
        connection.disconnect()
        if (file.length() > 0) file else null
    } catch (ignored: Exception) {
        null
    }

    /**
     * Hands the file to Android, which asks the viewer to confirm. On Android 8
     * and up an app has to be trusted to install others first, so the first
     * time through this opens that setting instead.
     */
    fun install(activity: Activity, apk: File) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !activity.packageManager.canRequestPackageInstalls()
        ) {
            activity.startActivity(
                Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${activity.packageName}")
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
            return
        }

        val intent = Intent(Intent.ACTION_VIEW).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.updates", apk)
            intent.setDataAndType(uri, APK_MIME).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } else {
            // Before Nougat the installer reads the file itself, so it has to be
            // somewhere it can see and readable when it gets there.
            @Suppress("DEPRECATION")
            apk.setReadable(true, false)
            intent.setDataAndType(Uri.fromFile(apk), APK_MIME)
        }
        activity.startActivity(intent)
    }

    private fun cacheDir(context: Context): File =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) context.cacheDir
        else context.externalCacheDir ?: context.cacheDir
}
