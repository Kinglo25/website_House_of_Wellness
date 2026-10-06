package com.streamhouse.tv

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.format.Formatter
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/**
 * What the torrent behind a film is doing — peers, speed, how much is here —
 * read from the engine every two seconds while a player waits, and handed to
 * [show] in words.
 */
class TorrentStatus(
    private val activity: Activity,
    private val server: String?,
    url: String,
    private val show: (String) -> Unit
) {
    companion object {
        private const val EVERY_MS = 2000L
        /** After this long waiting, the words add what to do about it. */
        private const val SLOW_MS = 60_000L
        private val INFO_HASH = Regex("/api/stream/([0-9a-fA-F]{40})")
    }

    private val hash = INFO_HASH.find(url)?.groupValues?.get(1)?.lowercase()
    private val main = Handler(Looper.getMainLooper())
    private var running = false
    private var since = 0L

    private val poll = object : Runnable {
        override fun run() {
            val address = server
            val id = hash
            if (!running || address == null || id == null) return
            val waited = SystemClock.elapsedRealtime() - since
            Thread {
                val text = try {
                    describe(torrent(address, id), waited)
                } catch (error: Exception) {
                    null
                }
                activity.runOnUiThread { if (text != null && running && !activity.isFinishing) show(text) }
            }.start()
            main.postDelayed(this, EVERY_MS)
        }
    }

    fun start() {
        if (running) return
        running = true
        since = SystemClock.elapsedRealtime()
        main.post(poll)
    }

    fun stop() {
        running = false
        main.removeCallbacks(poll)
    }

    /** This film's torrent as the engine lists it, or null when it is not there. */
    private fun torrent(address: String, id: String): JSONObject? {
        val connection = URL("$address/api/torrents").openConnection() as HttpURLConnection
        connection.connectTimeout = 3000
        connection.readTimeout = 3000
        try {
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            val torrents = JSONObject(body).optJSONArray("torrents") ?: return null
            for (index in 0 until torrents.length()) {
                val torrent = torrents.optJSONObject(index) ?: continue
                if (torrent.optString("id") == id || torrent.optString("infoHash") == id) return torrent
            }
            return null
        } finally {
            connection.disconnect()
        }
    }

    private fun describe(torrent: JSONObject?, waited: Long): String? {
        if (torrent == null) return null
        if (!torrent.isNull("error")) {
            val error = torrent.optString("error")
            if (error.isNotEmpty()) return activity.getString(R.string.status_error, error)
        }
        val peers = torrent.optInt("numPeers")
        val now = if (peers == 0) {
            activity.getString(R.string.status_no_peers)
        } else {
            val speed = Formatter.formatShortFileSize(activity, torrent.optDouble("downloadSpeed", 0.0).toLong())
            val percent = (torrent.optDouble("progress", 0.0) * 100).toInt()
            activity.resources.getQuantityString(R.plurals.status_downloading, peers, speed, peers, percent)
        }
        return if (waited < SLOW_MS) now else now + "\n\n" + activity.getString(R.string.status_slow)
    }
}

/** Hands the watch position back to the engine, so "Continue watching" carries on from it. */
object WatchPosition {
    fun report(server: String?, key: String?, positionMs: Long, durationMs: Long) {
        if (server == null || key.isNullOrEmpty() || durationMs <= 0) return
        val body = JSONObject()
            .put("id", key)
            .put("time", positionMs / 1000.0)
            .put("duration", durationMs / 1000.0)
            .toString()
        Thread {
            try {
                val connection = (URL("$server/api/progress").openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    doOutput = true
                    connectTimeout = 4000
                    readTimeout = 4000
                    setRequestProperty("Content-Type", "application/json")
                }
                OutputStreamWriter(connection.outputStream).use { it.write(body) }
                connection.responseCode
                connection.disconnect()
            } catch (ignored: Exception) {
                // Best effort: losing a resume point is not worth a crash.
            }
        }.start()
    }
}
