package io.github.dontbass.router404

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.text.SpannableString
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.widget.RemoteViews
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Draws every placed widget from the last stored answer. */
object Renderer {
    private const val OK = 0xFF3DDC97.toInt()
    private const val WARN = 0xFFFFB648.toInt()
    private const val BAD = 0xFFFF5470.toInt()
    private const val CYAN = 0xFF2BE4FF.toInt()
    private const val INK = 0xFFF2F6FB.toInt()
    private const val TEXT = 0xFFC9D4E1.toInt()
    private const val DIM = 0xFF8796A8.toInt()
    private const val FAINT = 0xFF56657A.toInt()
    private const val TRACK = 0x4D8796A8

    private val TIME = SimpleDateFormat("HH:mm", Locale.getDefault())

    fun pushAll(ctx: Context, loading: Boolean = false) {
        val mgr = AppWidgetManager.getInstance(ctx)
        val ids = mgr.getAppWidgetIds(ComponentName(ctx, RouterWidget::class.java))
        for (id in ids) push(ctx, mgr, id, loading)
    }

    fun push(ctx: Context, mgr: AppWidgetManager, id: Int, loading: Boolean = false) {
        val opts = mgr.getAppWidgetOptions(id)
        val minH = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 110)
        val compact = minH in 1..99
        val v = RemoteViews(ctx.packageName, if (compact) R.layout.widget_compact else R.layout.widget_full)
        fill(ctx, v, compact, loading)
        mgr.updateAppWidget(id, v)
    }

    private fun delayColor(ms: Int?): Int = when {
        ms == null || ms <= 0 -> BAD
        ms < 150 -> OK
        ms < 400 -> WARN
        else -> BAD
    }

    private fun bars(n: Int, color: Int): CharSequence {
        val s = SpannableString("▂▄▆█")
        for (i in 0 until 4)
            s.setSpan(ForegroundColorSpan(if (i < n) color else TRACK), i, i + 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        return s
    }

    private fun minus(n: Int): String = n.toString().replace('-', '−')

    private fun fill(ctx: Context, v: RemoteViews, compact: Boolean, loading: Boolean) {
        val s = Repo.last(ctx)
        val err = Config.error(ctx)
        val at = Config.lastAt(ctx)

        // a tap on the top line asks the router again, the rest opens the app
        val refresh = Intent(ctx, RouterWidget::class.java).setAction(RouterWidget.ACTION_REFRESH)
        val piRefresh = PendingIntent.getBroadcast(ctx, 1, refresh, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        v.setOnClickPendingIntent(R.id.root, piRefresh)
        v.setOnClickPendingIntent(R.id.row_net, piRefresh)
        val open = if (Config.configured(ctx))
            Intent(Intent.ACTION_VIEW, Uri.parse(Config.appUrl(ctx, s)))
        else
            Intent(ctx, MainActivity::class.java)
        val piOpen = PendingIntent.getActivity(ctx, 2, open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        v.setOnClickPendingIntent(R.id.row_cell, piOpen)
        if (!compact) v.setOnClickPendingIntent(R.id.row_proxy, piOpen)

        val stale = err != null
        val time = if (at > 0) TIME.format(Date(at)) else "—"
        v.setTextViewText(R.id.updated, when {
            loading -> "⟳ …"
            stale -> "⚠ $time"
            else -> "⟳ $time"
        })
        v.setTextColor(R.id.updated, if (stale) WARN else FAINT)

        if (!Config.configured(ctx) || s == null) {
            val msg = when {
                !Config.configured(ctx) -> "Нажмите, чтобы настроить"
                err != null -> err
                else -> "Спрашиваем роутер…"
            }
            v.setTextColor(R.id.dot, DIM)
            if (compact) {
                v.setTextViewText(R.id.node, msg)
                v.setTextViewText(R.id.flag, "")
                v.setTextViewText(R.id.delay, "")
                v.setTextViewText(R.id.op, "")
                v.setTextViewText(R.id.rsrp, "")
            } else {
                v.setTextViewText(R.id.net_text, msg)
                v.setTextViewText(R.id.ping, "")
                v.setTextViewText(R.id.flag, "")
                v.setTextViewText(R.id.node, "")
                v.setTextViewText(R.id.delay, "")
                v.setTextViewText(R.id.rsrp, "")
                v.setTextViewText(R.id.rsrp_unit, "")
                v.setTextViewText(R.id.op, "")
                v.setTextViewText(R.id.kind, "")
                v.setInt(R.id.kind, "setVisibility", android.view.View.GONE)
            }
            v.setTextViewText(R.id.bars, bars(0, CYAN))
            if (!Config.configured(ctx)) {
                val setup = PendingIntent.getActivity(ctx, 3, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
                v.setOnClickPendingIntent(R.id.root, setup)
                v.setOnClickPendingIntent(R.id.row_net, setup)
            }
            return
        }

        // internet
        val netColor = if (stale) DIM else if (s.online) OK else BAD
        v.setTextColor(R.id.dot, netColor)
        if (!compact) {
            v.setTextViewText(R.id.net_text, if (stale) "Роутер не отвечает" else if (s.online) "Интернет есть" else "Нет интернета")
            v.setTextColor(R.id.net_text, if (stale) DIM else INK)
            v.setTextViewText(R.id.ping, if (s.online && s.ping != null && !stale) "${s.ping} мс" else "")
            v.setTextColor(R.id.ping, delayColor(s.ping))
        }

        // proxy
        val (flag, node, delay, dColor) = when {
            !s.proxyInstalled -> Quad("", if (s.via != null) "через ${s.via}" else "Без прокси", "", DIM)
            !s.proxyRunning -> Quad("", "Прокси выключен", "", DIM)
            s.direct -> Quad("", "Напрямую", "", DIM)
            else -> Quad(Flags.of(s.node), Flags.bare(s.node).ifEmpty { "—" }, if ((s.delay ?: 0) > 0) "${s.delay} мс" else "нет ответа", delayColor(s.delay))
        }
        val nodeText = if (compact && !s.online && !stale) "Нет интернета" else node
        v.setTextViewText(R.id.flag, flag)
        v.setTextViewText(R.id.node, nodeText)
        v.setTextColor(R.id.node, if (compact && !s.online && !stale) BAD else if (stale) DIM else INK)
        v.setTextViewText(R.id.delay, if (stale) "" else delay)
        v.setTextColor(R.id.delay, dColor)

        // cell
        if (s.cellPresent) {
            val rsrpColor = when {
                s.rsrp == null -> DIM
                s.rsrp >= -95 -> OK
                s.rsrp >= -110 -> WARN
                else -> BAD
            }
            v.setTextViewText(R.id.bars, bars(s.bars, if (stale) DIM else CYAN))
            v.setTextViewText(R.id.rsrp, s.rsrp?.let { minus(it) } ?: "—")
            v.setTextColor(R.id.rsrp, if (stale) DIM else rsrpColor)
            if (compact) {
                v.setTextViewText(R.id.op, s.combo ?: s.operator ?: "")
            } else {
                v.setTextViewText(R.id.rsrp_unit, "дБм")
                v.setTextViewText(R.id.op, listOfNotNull(s.operator, s.combo).joinToString(" · ").ifEmpty { if (s.cellOnline) "" else "Модем не в сети" })
                v.setTextColor(R.id.op, TEXT)
                v.setTextViewText(R.id.kind, s.kind ?: "")
                v.setInt(R.id.kind, "setVisibility", if (s.kind.isNullOrEmpty()) android.view.View.GONE else android.view.View.VISIBLE)
            }
        } else {
            v.setTextViewText(R.id.bars, "")
            v.setTextViewText(R.id.rsrp, "")
            v.setTextViewText(R.id.op, s.host ?: "")
            if (!compact) {
                v.setTextViewText(R.id.rsrp_unit, "")
                v.setInt(R.id.kind, "setVisibility", android.view.View.GONE)
            }
        }
    }

    private data class Quad(val a: String, val b: String, val c: String, val d: Int)
}
