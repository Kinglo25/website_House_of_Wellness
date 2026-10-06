package com.streamhouse.tv

import android.content.Context

/** Remembers where this device's StreamHouse runs: inside the app, or on a computer. */
object Prefs {
    private const val FILE = "streamhouse"
    private const val KEY_SERVER = "server_url"
    private const val KEY_UPDATE_LATER = "update_later_until"

    /** Stored in place of an address when the app runs StreamHouse itself — the default. */
    const val THIS_DEVICE = "this-device"

    fun server(context: Context): String =
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
            .getString(KEY_SERVER, null) ?: THIS_DEVICE

    fun setServer(context: Context, value: String) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_SERVER, value)
            .apply()
    }

    /** Until when "Later" puts off the offer of an update, in epoch milliseconds. */
    fun updateLaterUntil(context: Context): Long =
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getLong(KEY_UPDATE_LATER, 0L)

    fun setUpdateLaterUntil(context: Context, value: Long) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
            .edit()
            .putLong(KEY_UPDATE_LATER, value)
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
