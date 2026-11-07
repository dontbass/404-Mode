package io.github.dontbass.router404

import android.content.Context
import android.content.SharedPreferences

/** Where the router is, its access key and the last answer it gave. */
object Config {
    private fun prefs(ctx: Context): SharedPreferences =
        ctx.getSharedPreferences("router404", Context.MODE_PRIVATE)

    fun host(ctx: Context): String = prefs(ctx).getString("host", "") ?: ""
    fun token(ctx: Context): String = prefs(ctx).getString("token", "") ?: ""
    fun configured(ctx: Context): Boolean = host(ctx).isNotEmpty() && token(ctx).length == 32

    fun save(ctx: Context, host: String, token: String) {
        prefs(ctx).edit()
            .putString("host", normalizeHost(host))
            .putString("token", token.trim().lowercase())
            .remove("last").remove("lastAt").remove("error")
            .apply()
    }

    fun lastJson(ctx: Context): String? = prefs(ctx).getString("last", null)
    fun lastAt(ctx: Context): Long = prefs(ctx).getLong("lastAt", 0L)
    fun error(ctx: Context): String? = prefs(ctx).getString("error", null)

    fun storeAnswer(ctx: Context, json: String) {
        prefs(ctx).edit()
            .putString("last", json)
            .putLong("lastAt", System.currentTimeMillis())
            .remove("error")
            .apply()
    }

    fun storeError(ctx: Context, message: String) {
        prefs(ctx).edit().putString("error", message).apply()
    }

    /** "192.168.88.1", "http://192.168.88.1/", "https://router.example.ru" → base URL without a slash */
    fun normalizeHost(raw: String): String {
        var h = raw.trim().trimEnd('/')
        if (h.isEmpty()) return ""
        if (!h.startsWith("http://") && !h.startsWith("https://")) h = "http://$h"
        val path = h.indexOf('/', h.indexOf("//") + 2)
        return if (path > 0) h.substring(0, path) else h
    }

    fun appUrl(ctx: Context, status: Status?): String {
        val domain = status?.domain
        return if (!domain.isNullOrEmpty()) "https://$domain/app/" else host(ctx) + "/app/"
    }
}
