package com.streamhouse.tv

import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.view.WindowManager
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Tracks
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
 *
 * A file ExoPlayer cannot read, or whose sound or picture this device cannot
 * decode, goes to [VlcPlayerActivity] instead, from the same point.
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
    }

    private lateinit var binding: ActivityPlayerBinding
    private var player: ExoPlayer? = null
    private var status: TorrentStatus? = null
    private var handedOver = false

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
        status = TorrentStatus(this, intent.getStringExtra(EXTRA_SERVER), url) { binding.status.text = it }

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
                if (vlcMightPlay(error)) handOverToVlc() else showFailure(error)
            }

            // A film whose sound (DTS, TrueHD) or picture this device cannot
            // decode would otherwise play silent, or as sound over a black screen.
            override fun onTracksChanged(tracks: Tracks) {
                val silent = tracks.containsType(C.TRACK_TYPE_AUDIO) && !tracks.isTypeSupported(C.TRACK_TYPE_AUDIO)
                val blind = tracks.containsType(C.TRACK_TYPE_VIDEO) && !tracks.isTypeSupported(C.TRACK_TYPE_VIDEO)
                if (silent || blind) handOverToVlc()
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                val waiting = playbackState == Player.STATE_BUFFERING
                binding.waiting.visibility = if (waiting) View.VISIBLE else View.GONE
                if (waiting) status?.start() else status?.stop()
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
        status?.stop()
        player?.let { WatchPosition.report(intent.getStringExtra(EXTRA_SERVER), intent.getStringExtra(EXTRA_PROGRESS_KEY), it.currentPosition, it.duration) }
        player?.release()
        player = null
        super.onDestroy()
    }

    // Errors reading the file (3xxx), decoding it (4xxx) or sounding it (5xxx):
    // VLC reads and decodes far more than ExoPlayer, in software if need be.
    private fun vlcMightPlay(error: PlaybackException) = error.errorCode in 3000..5999

    /** VLC carries on from here; the position is written back from there. */
    private fun handOverToVlc() {
        if (handedOver) return
        handedOver = true
        val reached = player?.currentPosition ?: 0L
        val from = if (reached > 0) reached else intent.getLongExtra(EXTRA_START_MS, 0L)
        startActivity(Intent(this, VlcPlayerActivity::class.java).putExtras(intent).putExtra(EXTRA_START_MS, from))
        // VLC reports the position from now on.
        player?.release()
        player = null
        finish()
    }

    /** Says why, in words, and how to get out of it: Back. */
    private fun showFailure(error: PlaybackException) {
        status?.stop()
        binding.waiting.visibility = View.GONE
        binding.title.visibility = View.VISIBLE
        val reason = when (error.errorCode) {
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
            PlaybackException.ERROR_CODE_TIMEOUT -> R.string.failed_no_data
            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS -> R.string.failed_engine
            else -> R.string.failed_other
        }
        binding.message.text = getString(R.string.playback_failed, getString(reason), error.errorCodeName)
        binding.message.visibility = View.VISIBLE
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
