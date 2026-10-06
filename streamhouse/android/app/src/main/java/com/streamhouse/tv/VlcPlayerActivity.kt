package com.streamhouse.tv

import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import androidx.appcompat.app.AppCompatActivity
import com.streamhouse.tv.databinding.ActivityVlcPlayerBinding
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media
import org.videolan.libvlc.MediaPlayer

/**
 * The second player: VLC, for the files [PlayerActivity] cannot read or whose
 * sound or picture this device cannot decode — unusual MKV and AVI files, DTS
 * and TrueHD soundtracks. It starts where that one stopped.
 *
 * VLC has no remote-control screen of its own, so this draws a small one: OK
 * pauses and plays, left and right jump back 10 and forward 30 seconds, Back
 * leaves.
 */
class VlcPlayerActivity : AppCompatActivity() {

    companion object {
        private const val CONTROLS_SHOWN_MS = 4000L
    }

    private lateinit var binding: ActivityVlcPlayerBinding
    private var libVlc: LibVLC? = null
    private var player: MediaPlayer? = null
    private var status: TorrentStatus? = null
    private val main = Handler(Looper.getMainLooper())
    private val hideControls = Runnable { if (player?.isPlaying == true) binding.controls.visibility = View.GONE }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityVlcPlayerBinding.inflate(layoutInflater)
        setContentView(binding.root)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val url = intent.getStringExtra(PlayerActivity.EXTRA_URL)
        if (url.isNullOrEmpty()) {
            finish()
            return
        }
        binding.title.text = intent.getStringExtra(PlayerActivity.EXTRA_TITLE).orEmpty()
        status = TorrentStatus(this, intent.getStringExtra(PlayerActivity.EXTRA_SERVER), url) { binding.status.text = it }
        showWaiting(true)

        try {
            val vlc = LibVLC(this, arrayListOf("--network-caching=3000", "--http-reconnect"))
            libVlc = vlc
            val mediaPlayer = MediaPlayer(vlc)
            player = mediaPlayer
            mediaPlayer.attachViews(binding.video, null, true, false)
            val media = Media(vlc, Uri.parse(url))
            media.setHWDecoderEnabled(true, false)
            val startMs = intent.getLongExtra(PlayerActivity.EXTRA_START_MS, 0L)
            if (startMs > 0) media.addOption(":start-time=${startMs / 1000.0}")
            mediaPlayer.setMedia(media)
            media.release()
            mediaPlayer.setEventListener(object : MediaPlayer.EventListener {
                override fun onEvent(event: MediaPlayer.Event) {
                    onPlayerEvent(event)
                }
            })
            mediaPlayer.play()
        } catch (error: Throwable) {
            // VLC's own libraries would not load on this device.
            showFailure()
        }
    }

    private fun onPlayerEvent(event: MediaPlayer.Event) {
        when (event.type) {
            MediaPlayer.Event.Buffering -> showWaiting(event.buffering < 100f)
            MediaPlayer.Event.Playing -> {
                showWaiting(false)
                drawTime()
            }
            MediaPlayer.Event.Paused -> showControls()
            MediaPlayer.Event.TimeChanged -> drawTime()
            MediaPlayer.Event.EndReached -> finish()
            MediaPlayer.Event.EncounteredError -> showFailure()
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        val mediaPlayer = player ?: return super.onKeyDown(keyCode, event)
        when (keyCode) {
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER,
            KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
                if (mediaPlayer.isPlaying) mediaPlayer.pause() else mediaPlayer.play()
            }
            KeyEvent.KEYCODE_MEDIA_PLAY -> mediaPlayer.play()
            KeyEvent.KEYCODE_MEDIA_PAUSE -> mediaPlayer.pause()
            KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_REWIND -> jump(-10_000L)
            KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> jump(30_000L)
            KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_INFO -> {}
            else -> return super.onKeyDown(keyCode, event)
        }
        showControls()
        return true
    }

    private fun jump(byMs: Long) {
        val mediaPlayer = player ?: return
        val length = mediaPlayer.length
        var target = (mediaPlayer.time + byMs).coerceAtLeast(0L)
        if (length > 0) target = target.coerceAtMost(length - 1000L)
        mediaPlayer.setTime(target)
        drawTime(target)
    }

    private fun showControls() {
        binding.controls.visibility = View.VISIBLE
        main.removeCallbacks(hideControls)
        main.postDelayed(hideControls, CONTROLS_SHOWN_MS)
        drawTime()
    }

    private fun drawTime(at: Long? = null) {
        val mediaPlayer = player ?: return
        val time = at ?: mediaPlayer.time
        val length = mediaPlayer.length
        binding.position.text = if (length > 0) "${clock(time)} / ${clock(length)}" else clock(time)
        binding.seek.progress = if (length > 0) (time * 1000 / length).toInt() else 0
    }

    private fun clock(ms: Long): String {
        val seconds = (ms / 1000).coerceAtLeast(0L)
        val hours = seconds / 3600
        val minutes = seconds % 3600 / 60
        return if (hours > 0) "%d:%02d:%02d".format(hours, minutes, seconds % 60) else "%d:%02d".format(minutes, seconds % 60)
    }

    private fun showWaiting(waiting: Boolean) {
        binding.waiting.visibility = if (waiting) View.VISIBLE else View.GONE
        if (waiting) status?.start() else status?.stop()
    }

    private fun showFailure() {
        showWaiting(false)
        binding.controls.visibility = View.GONE
        binding.message.text = getString(R.string.failed_vlc)
        binding.message.visibility = View.VISIBLE
    }

    override fun onPause() {
        super.onPause()
        player?.pause()
    }

    override fun onDestroy() {
        status?.stop()
        main.removeCallbacks(hideControls)
        player?.let {
            WatchPosition.report(
                intent.getStringExtra(PlayerActivity.EXTRA_SERVER),
                intent.getStringExtra(PlayerActivity.EXTRA_PROGRESS_KEY),
                it.time,
                it.length
            )
            it.stop()
            it.detachViews()
            it.release()
        }
        player = null
        libVlc?.release()
        libVlc = null
        super.onDestroy()
    }
}
