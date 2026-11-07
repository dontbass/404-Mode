package io.github.dontbass.router404

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context

/** Refreshes the widgets in the background, as often as Android allows (15 min). */
class RefreshJob : JobService() {

    companion object {
        private const val ID = 404

        fun schedule(ctx: Context) {
            val js = ctx.getSystemService(JobScheduler::class.java) ?: return
            if (js.getPendingJob(ID) != null) return
            val job = JobInfo.Builder(ID, ComponentName(ctx, RefreshJob::class.java))
                .setPeriodic(15 * 60 * 1000L)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .build()
            js.schedule(job)
        }

        fun cancel(ctx: Context) {
            ctx.getSystemService(JobScheduler::class.java)?.cancel(ID)
        }
    }

    override fun onStartJob(params: JobParameters): Boolean {
        Thread {
            try {
                Repo.refresh(applicationContext)
                Renderer.pushAll(applicationContext)
            } catch (e: Exception) {
            } finally {
                jobFinished(params, false)
            }
        }.start()
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean = true
}
