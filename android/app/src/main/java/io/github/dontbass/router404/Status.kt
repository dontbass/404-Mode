package io.github.dontbass.router404

import org.json.JSONObject
import kotlin.math.roundToInt

/** The router's answer from /cgi-bin/404status, reduced to what the widget shows. */
data class Status(
    val online: Boolean,
    val ping: Int?,
    val via: String?,
    val proxyInstalled: Boolean,
    val proxyRunning: Boolean,
    val direct: Boolean,
    val node: String?,
    val delay: Int?,
    val cellPresent: Boolean,
    val cellOnline: Boolean,
    val operator: String?,
    val kind: String?,
    val combo: String?,
    val rsrp: Int?,
    val sinr: Int?,
    val bars: Int,
    val host: String?,
    val domain: String?,
    val lan: String?
) {
    companion object {
        private fun JSONObject.intOrNull(key: String): Int? =
            if (has(key) && !isNull(key)) optDouble(key, Double.NaN).takeIf { !it.isNaN() }?.roundToInt() else null

        private fun JSONObject.strOrNull(key: String): String? =
            if (has(key) && !isNull(key)) optString(key).takeIf { it.isNotEmpty() } else null

        fun parse(json: String): Status {
            val o = JSONObject(json)
            val net = o.optJSONObject("net") ?: JSONObject()
            val px = o.optJSONObject("proxy") ?: JSONObject()
            val cell = o.optJSONObject("cell") ?: JSONObject()
            val sys = o.optJSONObject("sys") ?: JSONObject()
            return Status(
                online = net.optBoolean("online", false),
                ping = net.intOrNull("ping"),
                via = net.strOrNull("via"),
                proxyInstalled = px.optBoolean("installed", false),
                proxyRunning = px.optBoolean("running", false),
                direct = px.optBoolean("direct", false),
                node = px.strOrNull("node"),
                delay = px.intOrNull("delay"),
                cellPresent = cell.optBoolean("present", false),
                cellOnline = cell.optBoolean("online", false),
                operator = cell.strOrNull("operator"),
                kind = cell.strOrNull("kind"),
                combo = cell.strOrNull("combo"),
                rsrp = cell.intOrNull("rsrp"),
                sinr = cell.intOrNull("sinr"),
                bars = cell.intOrNull("bars") ?: 0,
                host = sys.strOrNull("host"),
                domain = sys.strOrNull("domain"),
                lan = sys.strOrNull("lan")
            )
        }
    }
}
