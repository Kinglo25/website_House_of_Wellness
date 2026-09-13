package com.streamhouse.tv

import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
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
 */
class PlayerActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_URL = "url"
        const val EXTRA_TITLE = "title"
        const val EXTRA_START_MS = "startMs"
        const val EXTRA_PROGRESS_KEY = "progressKey"
        const val EXTRA_SERVER = "server"

        /** Set on the result when the web page should queue up what follows. */
        const val RESULT_PLAY_NEXT = "playNext"
    }

    private lateinit var binding: ActivityPlayerBinding
    private var player: ExoPlayer? = null

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

        val title = intent.getStringExtra(EXTRA_TITLE).orEmpty()
        binding.title.text = title

        val exoPlayer = ExoPlayer.Builder(this).build()
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
                binding.title.visibility = View.VISIBLE
                Toast.makeText(
                    this@PlayerActivity,
                    getString(R.string.playback_failed, error.errorCodeName),
                    Toast.LENGTH_LONG
                ).show()
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                binding.buffering.visibility =
                    if (playbackState == Player.STATE_BUFFERING) View.VISIBLE else View.GONE
                if (playbackState == Player.STATE_ENDED) finishAndPlayNext()
            }
        })

        exoPlayer.playWhenReady = true
        exoPlayer.prepare()
    }

    /**
     * Hand back to the web page with "carry on" attached: it knows whether this
     * was an episode and what comes after it. A film simply stops here.
     */
    private fun finishAndPlayNext() {
        setResult(RESULT_OK, Intent().putExtra(RESULT_PLAY_NEXT, true))
        finish()
    }

    /** The remote's skip-forward key means the next episode, not the next file. */
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_MEDIA_NEXT) {
            finishAndPlayNext()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onPause() {
        super.onPause()
        player?.pause()
    }

    override fun onDestroy() {
        reportProgress()
        player?.release()
        player = null
        super.onDestroy()
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
