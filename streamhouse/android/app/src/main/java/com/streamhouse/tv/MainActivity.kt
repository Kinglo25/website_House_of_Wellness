package com.streamhouse.tv

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.streamhouse.tv.databinding.ActivityMainBinding

/**
 * The app is a shell around the StreamHouse web interface, which already has a
 * ten-foot layout and D-pad navigation. Video does not play in the WebView:
 * the page hands playback to [PlayerActivity], which uses ExoPlayer and so
 * copes with MKV, HEVC and AC3 the way a WebView cannot.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private var serverUrl: String? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        with(binding.webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            loadWithOverviewMode = true
            useWideViewPort = true
            cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
        }
        binding.webView.setBackgroundColor(0xFF0B0B17.toInt())
        binding.webView.addJavascriptInterface(WebBridge(this), WebBridge.NAME)

        binding.webView.webChromeClient = WebChromeClient()
        binding.webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                binding.progress.visibility = View.GONE
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                if (request?.isForMainFrame != true) return
                binding.progress.visibility = View.GONE
                showUnreachable()
            }
        }

        binding.retry.setOnClickListener { load() }
        binding.change.setOnClickListener { openSetup() }
    }

    override fun onResume() {
        super.onResume()
        val saved = Prefs.serverUrl(this)
        if (saved == null) {
            openSetup()
            return
        }
        if (saved != serverUrl) {
            serverUrl = saved
            load()
        }
    }

    private fun load() {
        val url = serverUrl ?: return
        binding.error.visibility = View.GONE
        binding.progress.visibility = View.VISIBLE
        // ?tv=1 puts the web interface straight into ten-foot mode.
        binding.webView.loadUrl("$url/?tv=1")
        binding.webView.requestFocus()
    }

    private fun showUnreachable() {
        binding.message.text = getString(R.string.cannot_reach, serverUrl ?: "")
        binding.error.visibility = View.VISIBLE
        binding.retry.requestFocus()
    }

    fun openSetup() {
        startActivity(Intent(this, SetupActivity::class.java))
    }

    /** Called from the web page through the JavaScript bridge. */
    fun startPlayback(url: String, title: String, startSeconds: Double, progressKey: String) {
        runOnUiThread {
            startActivity(
                Intent(this, PlayerActivity::class.java)
                    .putExtra(PlayerActivity.EXTRA_URL, url)
                    .putExtra(PlayerActivity.EXTRA_TITLE, title)
                    .putExtra(PlayerActivity.EXTRA_START_MS, (startSeconds * 1000).toLong())
                    .putExtra(PlayerActivity.EXTRA_PROGRESS_KEY, progressKey)
                    .putExtra(PlayerActivity.EXTRA_SERVER, serverUrl)
            )
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        when (keyCode) {
            KeyEvent.KEYCODE_BACK -> {
                if (binding.error.visibility == View.VISIBLE) return super.onKeyDown(keyCode, event)
                if (binding.webView.canGoBack()) {
                    binding.webView.goBack()
                    return true
                }
                confirmExit()
                return true
            }
            // Menu / settings on the remote reopens the server picker.
            KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_SETTINGS -> {
                openSetup()
                return true
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    private fun confirmExit() {
        AlertDialog.Builder(this)
            .setTitle(R.string.exit_title)
            .setPositiveButton(R.string.exit_yes) { _, _ -> finish() }
            .setNegativeButton(R.string.exit_no, null)
            .show()
    }

    override fun onDestroy() {
        binding.webView.destroy()
        super.onDestroy()
    }
}
