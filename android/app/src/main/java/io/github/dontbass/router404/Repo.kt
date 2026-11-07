package io.github.dontbass.router404

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

class AuthException : IOException("key")

/** Talks to the router. Inside the home network the request goes over Wi-Fi
 *  even when Android marked that Wi-Fi "no internet" and moved to mobile data. */
object Repo {
    fun fetch(ctx: Context, base: String, token: String): String {
        val url = URL("$base/cgi-bin/404status")
        val cm = ctx.getSystemService(ConnectivityManager::class.java)
        @Suppress("DEPRECATION")
        val wifi = cm?.let { m ->
            m.allNetworks.firstOrNull { n ->
                m.getNetworkCapabilities(n)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
            }
        }
        val conn = (wifi?.openConnection(url) ?: url.openConnection()) as HttpURLConnection
        conn.connectTimeout = 4000
        conn.readTimeout = 9000
        conn.useCaches = false
        conn.setRequestProperty("Authorization", "Bearer $token")
        conn.setRequestProperty("Accept", "application/json")
        try {
            val code = conn.responseCode
            if (code == 403) throw AuthException()
            if (code != 200) throw IOException("HTTP $code")
            return conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    /** Ask the router and keep the answer (or why there is none). */
    fun refresh(ctx: Context): Boolean {
        if (!Config.configured(ctx)) return false
        return try {
            val json = fetch(ctx, Config.host(ctx), Config.token(ctx))
            Status.parse(json)
            Config.storeAnswer(ctx, json)
            true
        } catch (e: AuthException) {
            Config.storeError(ctx, "Ключ не подошёл")
            false
        } catch (e: Exception) {
            Config.storeError(ctx, "Роутер не отвечает")
            false
        }
    }

    fun last(ctx: Context): Status? = Config.lastJson(ctx)?.let {
        try { Status.parse(it) } catch (e: Exception) { null }
    }
}
