package com.streamhouse.tv

import android.content.Context

/** Remembers which StreamHouse server this TV talks to. */
object Prefs {
    private const val FILE = "streamhouse"
    private const val KEY_SERVER = "server_url"

    fun serverUrl(context: Context): String? =
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
            .getString(KEY_SERVER, null)

    fun setServerUrl(context: Context, url: String?) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_SERVER, url)
            .apply()
    }

    /** Accepts "192.168.1.34", "192.168.1.34:11471" or a full URL. */
    fun normalize(input: String): String {
        var value = input.trim()
        if (value.isEmpty()) return ""
        if (!value.startsWith("http://") && !value.startsWith("https://")) {
            value = "http://$value"
        }
        value = value.trimEnd('/')
        // Default to the StreamHouse port when the user typed only an address.
        val afterScheme = value.substringAfter("://")
        if (!afterScheme.contains(':')) value = "$value:11471"
        return value
    }
}
