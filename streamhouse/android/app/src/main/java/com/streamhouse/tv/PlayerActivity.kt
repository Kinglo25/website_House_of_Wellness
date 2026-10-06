package com.streamhouse.tv

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.format.Formatter
import android.view.View
import android.view.WindowManager
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.TransferListener
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import com.streamhouse.tv.databinding.ActivityPlayerBinding
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/**
 * Native playback with ExoPlayer.
 *
 * This is the reason the app exists rather than just a browser: ExoPlayer plays
 * the MKV / H.265 / AC3 files that torrents actually contain, which a WebView
 * mostly refuses. It streams from the StreamHouse server over HTTP byte ranges,
 * so it works while the file is still downloading.
 *
 * The server sends nothing until the torrent has the pieces asked for, which
 * takes a while when few people share it. ExoPlayer on its own gives up after
 * about half a minute of that; this keeps waiting while anything might still
 * come, and says what the torrent is doing meanwhile.
 */
class PlayerActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_URL = "url"
        const val EXTRA_TITLE = "title"
        const val EXTRA_START_MS = "startMs"
        const val EXTRA_PROGRESS_KEY = "progressKey"
        const val EXTRA_SERVER = "server"

        /** How long the film may go without a single byte arriving before it gives up. */
        private const val PATIENCE_MS = 3 * 60_000L
        private const val STATUS_EVERY_MS = 2000L
        private val INFO_HASH = Regex("/api/stream/([0-9a-fA-F]{40})")
    }

    private lateinit var binding: ActivityPlayerBinding
    private var player: ExoPlayer? = null
    private val main = Handler(Looper.getMainLooper())
    private var infoHash: String? = null
    private var polling = false

    /** When the last byte of the film arrived, written by ExoPlayer's loading thread. */
    @Volatile
    private var lastByteAt = SystemClock.elapsedRealtime()

    private val arrivals = object : TransferListener {
        override fun onTransferInitializing(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) {}
        override fun onTransferStart(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) {}
        override fun onBytesTransferred(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean, bytesTransferred: Int) {
            lastByteAt = SystemClock.elapsedRealtime()
        }
        override fun onTransferEnd(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) {}
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityPlayerBinding.inflate(layoutInflater)
        setContentView(binding.root)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val url = intent.getStringExtra(EXTRA_URL)
        if (url.isNullOrEmpty()) {
            Toast.makeText(this, R.string.nothing_to_play, Toast.LENGTH_LONG).show()
            finish()
            return
        }
        infoHash = INFO_HASH.find(url)?.groupValues?.get(1)?.lowercase()

        val title = intent.getStringExtra(EXTRA_TITLE).orEmpty()
        binding.title.text = title

        val http = DefaultHttpDataSource.Factory()
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(30_000)
            .setTransferListener(arrivals)
        val sources = DefaultMediaSourceFactory(DefaultDataSource.Factory(this, http))
            .setLoadErrorHandlingPolicy(PatientRetries(PATIENCE_MS) { SystemClock.elapsedRealtime() - lastByteAt })
        val exoPlayer = ExoPlayer.Builder(this).setMediaSourceFactory(sources).build()
        player = exoPlayer
        binding.playerView.player = exoPlayer
        binding.playerView.requestFocus()

        exoPlayer.setMediaItem(
            MediaItem.Builder()
                .setUri(url)
                .setMediaMetadata(MediaMetadata.Builder().setTitle(title).build())
                .build()
        )

        val startMs = intent.getLongExtra(EXTRA_START_MS, 0L)
        if (startMs > 0) exoPlayer.seekTo(startMs)

        exoPlayer.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                showFailure(error)
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                val waiting = playbackState == Player.STATE_BUFFERING
                binding.waiting.visibility = if (waiting) View.VISIBLE else View.GONE
                if (waiting) startStatus()
                if (playbackState == Player.STATE_ENDED) finish()
            }
        })

        exoPlayer.playWhenReady = true
        exoPlayer.prepare()
    }

    override fun onPause() {
        super.onPause()
        player?.pause()
    }

    override fun onDestroy() {
        main.removeCallbacks(pollStatus)
        reportProgress()
        player?.release()
        player = null
        super.onDestroy()
    }

    /** Says why, in words, and how to get out of it: Back. */
    private fun showFailure(error: PlaybackException) {
        main.removeCallbacks(pollStatus)
        polling = false
        binding.waiting.visibility = View.GONE
        binding.title.visibility = View.VISIBLE
        val reason = when (error.errorCode) {
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
            PlaybackException.ERROR_CODE_TIMEOUT -> R.string.failed_no_data
            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS -> R.string.failed_engine
            PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED,
            PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED -> R.string.failed_format
            PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
            PlaybackException.ERROR_CODE_DECODER_QUERY_FAILED,
            PlaybackException.ERROR_CODE_DECODING_FAILED,
            PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES,
            PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED -> R.string.failed_decoding
            else -> R.string.failed_other
        }
        binding.message.text = getString(R.string.playback_failed, getString(reason), error.errorCodeName)
        binding.message.visibility = View.VISIBLE
    }

    /* ---------------------------------------------- what the torrent is doing */

    private val pollStatus = object : Runnable {
        override fun run() {
            val server = intent.getStringExtra(EXTRA_SERVER)
            val hash = infoHash
            if (server == null || hash == null || binding.waiting.visibility != View.VISIBLE) {
                polling = false
                return
            }
            Thread {
                val text = try {
                    describe(torrentStatus(server, hash))
                } catch (error: Exception) {
                    null
                }
                runOnUiThread { if (text != null && !isFinishing) binding.status.text = text }
            }.start()
            main.postDelayed(this, STATUS_EVERY_MS)
        }
    }

    private fun startStatus() {
        if (polling) return
        polling = true
        main.post(pollStatus)
    }

    /** This film's torrent as the engine lists it, or null when it is not there. */
    private fun torrentStatus(server: String, hash: String): JSONObject? {
        val connection = URL("$server/api/torrents").openConnection() as HttpURLConnection
        connection.connectTimeout = 3000
        connection.readTimeout = 3000
        try {
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            val torrents = JSONObject(body).optJSONArray("torrents") ?: return null
            for (index in 0 until torrents.length()) {
                val torrent = torrents.optJSONObject(index) ?: continue
                if (torrent.optString("id") == hash || torrent.optString("infoHash") == hash) return torrent
            }
            return null
        } finally {
            connection.disconnect()
        }
    }

    private fun describe(torrent: JSONObject?): String? {
        if (torrent == null) return null
        if (!torrent.isNull("error")) {
            val error = torrent.optString("error")
            if (error.isNotEmpty()) return getString(R.string.status_error, error)
        }
        val peers = torrent.optInt("numPeers")
        if (peers == 0) return getString(R.string.status_no_peers)
        val speed = Formatter.formatShortFileSize(this, torrent.optDouble("downloadSpeed", 0.0).toLong())
        val percent = (torrent.optDouble("progress", 0.0) * 100).toInt()
        return resources.getQuantityString(R.plurals.status_downloading, peers, speed, peers, percent)
    }

    /** Hand the watch position back so "Continue watching" keeps working. */
    private fun reportProgress() {
        val server = intent.getStringExtra(EXTRA_SERVER) ?: return
        val key = intent.getStringExtra(EXTRA_PROGRESS_KEY) ?: return
        val current = player ?: return
        val positionSeconds = current.currentPosition / 1000.0
        val durationSeconds = if (current.duration > 0) current.duration / 1000.0 else 0.0
        if (key.isEmpty() || durationSeconds <= 0) return

        val body = JSONObject()
            .put("id", key)
            .put("time", positionSeconds)
            .put("duration", durationSeconds)
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

/**
 * Keeps trying while a slow torrent might still deliver: any error but an
 * unreadable or missing file waits a second and asks again, until nothing has
 * arrived for [patienceMs].
 */
private class PatientRetries(
    private val patienceMs: Long,
    private val stalledFor: () -> Long
) : DefaultLoadErrorHandlingPolicy() {

    override fun getRetryDelayMsFor(loadErrorInfo: LoadErrorHandlingPolicy.LoadErrorInfo): Long {
        if (super.getRetryDelayMsFor(loadErrorInfo) == C.TIME_UNSET) return C.TIME_UNSET
        val error = loadErrorInfo.exception
        if (error is HttpDataSource.InvalidResponseCodeException && error.responseCode in 400..499) return C.TIME_UNSET
        return if (stalledFor() > patienceMs) C.TIME_UNSET else 1000L
    }

    // Giving up is decided above, by time, not by how many tries it took.
    override fun getMinimumLoadableRetryCount(dataType: Int): Int = Int.MAX_VALUE
}
