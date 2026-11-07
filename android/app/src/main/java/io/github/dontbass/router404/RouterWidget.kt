package io.github.dontbass.router404

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.os.Bundle

class RouterWidget : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH = "io.github.dontbass.router404.REFRESH"
    }

    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        RefreshJob.schedule(ctx)
        refreshAsync(ctx)
    }

    override fun onEnabled(ctx: Context) {
        RefreshJob.schedule(ctx)
    }

    override fun onDisabled(ctx: Context) {
        RefreshJob.cancel(ctx)
    }

    override fun onAppWidgetOptionsChanged(ctx: Context, mgr: AppWidgetManager, id: Int, opts: Bundle) {
        Renderer.push(ctx, mgr, id)
    }

    override fun onReceive(ctx: Context, intent: Intent) {
        super.onReceive(ctx, intent)
        if (intent.action == ACTION_REFRESH) refreshAsync(ctx)
    }

    private fun refreshAsync(ctx: Context) {
        val app = ctx.applicationContext
        val pending = goAsync()
        Renderer.pushAll(app, loading = true)
        Thread {
            try {
                Repo.refresh(app)
                Renderer.pushAll(app)
            } catch (e: Exception) {
                // the widget keeps its last picture
            } finally {
                pending.finish()
            }
        }.start()
    }
}
