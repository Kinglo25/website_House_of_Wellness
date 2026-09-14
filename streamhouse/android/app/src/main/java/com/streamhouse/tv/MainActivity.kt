package com.streamhouse.tv

import android.annotation.SuppressLint
import android.app.UiModeManager
import android.content.Intent
import android.content.res.Configuration
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
 * ten-foot layout for TVs and a touch layout for phones. That interface comes
 * from StreamHouse running inside this app ([NodeEngine]) unless a computer
 * was picked instead.
 *
 * Video does not play in the WebView: the page hands playback to
 * [PlayerActivity], which uses ExoPlayer and so copes with MKV, HEVC and AC3
 * the way a WebView cannot.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    /** What is open: [Prefs.THIS_DEVICE], or a computer's address. */
    private var opened: String? = null
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
                if (opened == Prefs.THIS_DEVICE) showEngineFailure() else showUnreachable()
            }
        }

        binding.retry.setOnClickListener { retry() }
        binding.change.setOnClickListener { openSetup() }
    }

    override fun onResume() {
        super.onResume()
        val chosen = Prefs.server(this)
        if (chosen == opened) return
        opened = chosen
        if (chosen == Prefs.THIS_DEVICE) {
            startBuiltIn()
        } else {
            serverUrl = chosen
            load()
        }
    }

    private fun startBuiltIn() {
        serverUrl = null
        binding.error.visibility = View.GONE
        binding.progress.visibility = View.VISIBLE
        binding.starting.visibility = View.VISIBLE
        NodeEngine.start(this) { ready ->
            if (isDestroyed || opened != Prefs.THIS_DEVICE) return@start
            binding.starting.visibility = View.GONE
            if (ready) {
                serverUrl = NodeEngine.ADDRESS
                load()
            } else {
                binding.progress.visibility = View.GONE
                showEngineFailure()
            }
        }
    }

    private fun load() {
        val url = serverUrl ?: return
        binding.error.visibility = View.GONE
        binding.progress.visibility = View.VISIBLE
        // ?tv=1 puts the web interface straight into ten-foot mode; a phone
        // gets the touch layout.
        binding.webView.loadUrl("$url/?tv=${if (isTelevision()) 1 else 0}")
        binding.webView.requestFocus()
    }

    private fun isTelevision(): Boolean =
        (getSystemService(UI_MODE_SERVICE) as UiModeManager).currentModeType == Configuration.UI_MODE_TYPE_TELEVISION

    private fun retry() {
        when {
            opened != Prefs.THIS_DEVICE -> load()
            // Node cannot be started twice in one process: the app has to be
            // opened afresh.
            NodeEngine.stopped -> {
                finishAffinity()
                Runtime.getRuntime().exit(0)
            }
            else -> startBuiltIn()
        }
    }

    private fun showUnreachable() {
        showError(getString(R.string.cannot_reach, serverUrl ?: ""), getString(R.string.retry))
    }

    private fun showEngineFailure() {
        val reason = NodeEngine.failure ?: getString(R.string.engine_not_answering)
        val action = getString(if (NodeEngine.stopped) R.string.close_app else R.string.retry)
        showError(getString(R.string.engine_failed, reason), action)
    }

    private fun showError(message: String, action: String) {
        binding.message.text = message
        binding.retry.text = action
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
            // Menu / settings on the remote opens the choice of where StreamHouse runs.
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
