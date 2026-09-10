package com.streamhouse.tv

import android.webkit.JavascriptInterface

/**
 * What the web page can call on the TV.
 *
 * The page checks for `window.StreamHouseTV` and, when it is there, hands
 * playback to the native player instead of a <video> element.
 */
class WebBridge(private val activity: MainActivity) {

    companion object {
        const val NAME = "StreamHouseTV"
    }

    /** True lets the web app know it is running inside the TV app. */
    @JavascriptInterface
    fun isNativeTv(): Boolean = true

    @JavascriptInterface
    fun play(url: String, title: String, startSeconds: Double, progressKey: String) {
        activity.startPlayback(url, title, startSeconds, progressKey)
    }

    @JavascriptInterface
    fun changeServer() {
        activity.runOnUiThread { activity.openSetup() }
    }
}
